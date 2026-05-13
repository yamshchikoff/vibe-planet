# Техническая спецификация — PlanetRoot

## 1. Архитектура

PlanetRoot — фасад LOD-системы. Владеет 9 подсистемами + config + scene +
rootTransform. Выполняет покадровый цикл из 6 фаз.

**Sync-only generation:** первый релиз генерирует геометрию синхронно
(ChunkGenerator.generateSync). AsyncJobScheduler создаётся, но не используется;
генерация через Worker — отдельный следующий шаг.

## 2. Алгоритмы

### 2.1 Инициализация

```ts
const DEFAULTS: PlanetConfig = {
  planetRadius: 6371,
  seed: Math.random() * 2147483647,
  heightAmplitude: 8,
  maxDepth: 12,
  chunkResolution: 16,
  cacheSize: 1000,
};

class PlanetRoot {
  private config: PlanetConfig;
  private scene: Scene;
  private rootTransform: TransformNode;
  private sampler: HeightSampler;
  private quadtree: QuadtreeManager;
  private lodEvaluator: LODEvaluator;
  private generator: ChunkGenerator;
  private boundaryEngine: BoundaryContractEngine;
  private cache: CacheSubsystem;
  private scheduler: AsyncJobScheduler;

  constructor(config: Partial<PlanetConfig>, scene: Scene) {
    this.config = { ...DEFAULTS, ...config };
    this.scene = scene;
    this.rootTransform = new TransformNode('planetRoot', scene);
    this.sampler = new HeightSampler(this.config.seed);
    this.quadtree = new QuadtreeManager(this.config.maxDepth);
    this.lodEvaluator = new LODEvaluator(this.config.planetRadius, this.config.maxDepth);
    this.generator = new ChunkGenerator(this.sampler);
    this.boundaryEngine = new BoundaryContractEngine();
    this.scheduler = new AsyncJobScheduler(() => { throw new Error('workers not configured'); });
    this.cache = new CacheSubsystem({
      maxSize: this.config.cacheSize,
      onEvict: (key, entry) => {
        entry.mesh?.dispose();
        this.boundaryEngine.revoke(key);
      },
    });
  }
}
```

### 2.2 Покадровый цикл update(camera)

```
update(camera: Camera) → void
  cameraParams = LODEvaluator.extractCameraParams(camera, scene.getEngine())
  ctx = { cameraParams, splitSignals:[], mergeSignals:[], pendingLeaves:[], generatedThisFrame:0, generationBudget:4 }

  // ── Phase 1: DFS traversal ────────────────────────────────────────
  for each root in quadtree.getRoots():
    traverseNode(root, ctx)

  traverseNode(node, ctx):
    eval = lodEvaluator.evaluate(node, ctx.cameraParams)
    if not eval.isVisible AND node.state == 'virtual':  return    // skip

    if node.state == 'split':
      for each child in node.children:  traverseNode(child, ctx)
      if eval.shouldMerge:  ctx.mergeSignals.push({parent:node, children:node.children})
      return

    // Virtual or loaded leaf
    if eval.shouldSplit AND node.depth < config.maxDepth:
      ctx.splitSignals.push({ node, eval })
    else if node.state == 'virtual' AND eval.isVisible:
      ctx.pendingLeaves.push({ node, isVisible: true })

  // ── Phase 2: Split ────────────────────────────────────────────────
  // сначала split, потом merge (split открывает новые узлы для merge)
  for each signal in ctx.splitSignals:
    if signal.node.depth < config.maxDepth:
      quadtree.split(signal.node)
      if DEBUG:
        splitChildren = signal.node.children.map(c => cache.get(c.id)?.geometry).filter(truthy)
        if splitChildren.length == 4:
          ContractVerifier.checkSplitSeams(splitChildren, EPS_POSITION)

  // ── Phase 3: Merge ────────────────────────────────────────────────
  for each signal in ctx.mergeSignals:
    for each child in signal.children:
      // Пометить детей как evictable — mesh уже не нужен
      cache.put(child.id, { chunkId:child.id, mesh:null, geometry:null, lastAccess:0, state:'evictable', generationPromise:null })
    quadtree.merge(signal.children)

  // ── Phase 4: Ripple (enforceMaxDepthDelta) ────────────────────────
  for each signal in ctx.splitSignals:
    quadtree.enforceMaxDepthDelta(signal.node)

  // ── Phase 5: Generation ───────────────────────────────────────────
  // Детерминированный порядок: face-major 0→5, depth-minor, tx/ty lexicographic
  sort(ctx.pendingLeaves, by face, then depth, then tx, then ty)

  for each leaf in ctx.pendingLeaves:
    if ctx.generatedThisFrame >= ctx.generationBudget:  break
    if cache.has(leaf.node.id):  { cache.touch(leaf.node.id);  continue }   // уже есть

    request = {
      face: leaf.node.face, depth: leaf.node.depth,
      tx: leaf.node.tx, ty: leaf.node.ty,
      resolution: config.chunkResolution,
      planetRadius: config.planetRadius,
      heightAmplitude: config.heightAmplitude,
    }

    try:
      geometry = generator.generateSync(request)
      mesh = buildMesh(geometry, leaf.node.id, leaf.node.face)
      mesh.setParent(rootTransform)

      for each edge in [left, right, bottom, top]:
        boundaryEngine.declare(leaf.node.id, edge, geometry, config.planetRadius, config.heightAmplitude,
                               { face: leaf.node.face, depth: leaf.node.depth })

      cache.put(leaf.node.id, { chunkId:leaf.node.id, mesh, geometry, lastAccess:now, state:'ready', generationPromise:null })
      leaf.node.state = 'loaded'    // переводим узел из virtual → loaded

      // DEBUG: верификация контрактов с соседями
      if DEBUG:
        for each edge in [left, right, bottom, top]:
          neighbor = quadtree.getNeighborAtDepth(leaf.node, edge, leaf.node.depth)
          if neighbor AND neighbor.state == 'loaded':
            myContract = boundaryEngine.getContract(leaf.node.id, edge)
            neighborContract = boundaryEngine.getContract(neighbor.id, oppositeEdge(edge))
            if myContract AND neighborContract:
              ContractVerifier.checkContractMatch(myContract, neighborContract, EPS_POSITION)

      ctx.generatedThisFrame++

    catch error:
      console.error('Failed to generate chunk ${leaf.node.id}:', error)

  // ── Phase 6: Eviction ─────────────────────────────────────────────
  if cache.getSize() > config.cacheSize:
    cache.evict(cache.getSize() - config.cacheSize)
```

### 2.3 buildMesh

```
buildMesh(geometry: ChunkGeometry, chunkId: string, face: number) → Mesh:
  mesh = new Mesh(chunkId, scene)
  vertexData = new VertexData()
  vertexData.positions = geometry.positions
  vertexData.normals   = geometry.normals
  vertexData.colors    = geometry.colors
  vertexData.indices   = geometry.indices
  vertexData.applyToMesh(mesh, true)
  mesh.useVertexColors = true

  mat = new PBRMaterial('mat-' + chunkId, scene)
  mat.sideOrientation = 0   // CCW
  mat.roughness = 0.7
  mat.metallic = 0.0
  mesh.material = mat
  mesh.receiveShadows = true
  return mesh
```

### 2.4 getHeightAt

```
getHeightAt(worldPos: Vector3) → number:
  // Прямой запрос к HeightSampler. Optimisation: в будущем —
  // интерполяция из закэшированной геометрии через quadtree lookup.
  return sampler.getHeight(worldPos.x, worldPos.y, worldPos.z)
```

## 3. Структуры данных

```ts
export interface PlanetConfig {
  planetRadius: number;     // default 6371 (км)
  seed: number;             // random если не указано
  heightAmplitude: number;  // default 8
  maxDepth: number;         // default 12
  chunkResolution: number;  // default 16 (vertices per edge → (RES+1)²)
  cacheSize: number;        // default 1000
}

// Per-frame traversal context (internal)
interface TraversalCtx {
  cameraParams: CameraParams;
  splitSignals: { node: QuadNode; eval: LODEvaluation }[];
  mergeSignals: { parent: QuadNode; children: QuadNode[] }[];
  pendingLeaves: { node: QuadNode; isVisible: boolean }[];
  generationBudget: number;
  generatedThisFrame: number;
}

class PlanetRoot {
  constructor(config: Partial<PlanetConfig>, scene: Scene);
  update(camera: Camera): void;
  getHeightAt(worldPos: Vector3): number;
  getRoot(): TransformNode;
  getQuadtreeSnapshot(): { id, face, depth, tx, ty, state }[];
  dumpContracts(): { chunkId, edge, contract }[];
  dispose(): void;
}
```

**Memory footprint (без кэша):** ~2 KiB (подсистемы — лёгкие объекты).

## 4. Производительность

| Фаза | ~Time (типичный кадр) | Примечание |
|------|----------------------|------------|
| CameraParams extraction | < 0.1 ms | LODEvaluator.extractCameraParams |
| LOD-оценка (1000 узлов) | ~5 ms | DFS обход 6 корней |
| Split/merge + ripple | ~0.5 ms | QuadNode переключения |
| Генерация (sync, до 4 чанков) | ~40 ms | Ограничено generationBudget=4 |
| Кэширование + контракты | ~0.5 ms | CacheSubsystem.put + BoundaryContractEngine.declare |
| Eviction | ~0.5 ms | Приоритетное вытеснение |
| **Total (без генерации)** | **~7 ms** | **42% бюджета кадра (16.6 ms)** |

**Sync-only:** все чанки генерируются на главном потоке.
Лимит `generationBudget = 4` предотвращает подвисания.
При превышении бюджета кадра (16.6 ms) — warning в console.

## 5. Интеграция с Babylon.js

```ts
import { Camera, Mesh, PBRMaterial, TransformNode, VertexData } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';

// Camera params extraction — статический метод LODEvaluator:
//   LODEvaluator.extractCameraParams(camera, engine) → CameraParams
//   camera.fov — vertical FOV in radians
//   camera.minZ, camera.maxZ — near/far planes
//   camera.position — world position
//   engine.getRenderWidth/Height() — viewport
//   camera._frustumPlanes — frustum planes (6 шт.)

// Создание root transform для floating origin:
//   rootTransform = new TransformNode('planetRoot', scene)
//   Все меши чанков parented к rootTransform

// При dispose:
//   cache.dispose() → onEvict → mesh.dispose(), boundaryEngine.revoke()
//   scheduler.dispose()
//   rootTransform.dispose()
```

## 6. Обработка ошибок

| Условие | Поведение |
|---------|-----------|
| `planetRadius = 0` | Fallback к 1 (HeightSampler не работает с R=0) |
| `maxDepth = 0` | Планета из 6 корневых узлов, split невозможен |
| `cacheSize = 0` | put → onEvict → mesh сразу dispose (деградация, не падение) |
| `buildMesh` бросает исключение | ChunkGenerator.generateSync уже отработал — geometry создана, mesh нет. Ошибка логируется, ресурсы — на GC |
| Сцена остановлена | `update()` не вызывается движком, состояние сохраняется |
| Кэш переполнен | Приоритетное вытеснение: evictable → LRU ready |
| AsyncJobScheduler не настроен | runtime-заглушка (sync-only режим) |

## 7. Состояния

```
  [uninitialized] ──new PlanetRoot──→ [ready]
                                          │
                                          ├── update(camera) каждый кадр
                                          │   └── 6 фаз: traverse → split → merge → ripple → generate → evict
                                          │
                                          └── dispose() ──→ [disposed]
                                              ├── cache.dispose()
                                              ├── scheduler.dispose()
                                              ├── rootTransform.dispose()
                                              └── все меши освобождены
```

## Ссылки

- Requirement spec: `docs/LOD/01-planet-root.md`
- Architecture: `docs/LOD-architecture.md`
- Владеет: 9 подсистемами (QuadtreeManager, LODEvaluator, ChunkGenerator, HeightSampler, BoundaryContractEngine, CacheSubsystem, AsyncJobScheduler, PolarTopologyHandler, ContractVerifier)
