# Техническая спецификация — PlanetRoot

## 1. Алгоритмы

### 1.1 Инициализация

```ts
class PlanetRoot {
  private config: PlanetConfig;
  private scene: Scene;
  private rootTransform: TransformNode;

  // Подсистемы
  private quadtree: QuadtreeManager;
  private lodEvaluator: LODEvaluator;
  private chunkGenerator: ChunkGenerator;
  private cache: CacheSubsystem;
  private boundaryEngine: BoundaryContractEngine;
  private asyncScheduler: AsyncJobScheduler;
  private polarHandler: PolarTopologyHandler;
  private deformation: DeformationSystem;  // будущее — no-op
  private verifier: typeof ContractVerifier;  // DEBUG only

  // Состояние кадра
  private pendingMerges: QuadNode[];
  private generatedThisFrame: number;
  private frameStartTime: number;

  constructor(config: PlanetConfig, scene: Scene) {
    this.config = mergeDefaults(config);
    this.scene = scene;
    this.rootTransform = new TransformNode('planetRoot', scene);

    // Инициализировать подсистемы в порядке зависимостей
    this.polarHandler = new PolarTopologyHandler();
    this.quadtree = new QuadtreeManager(config.maxDepth, this.polarHandler);
    this.lodEvaluator = new LODEvaluator(config.planetRadius);
    this.boundaryEngine = new BoundaryContractEngine();
    this.asyncScheduler = new AsyncJobScheduler({
      workerCount: navigator.hardwareConcurrency - 1 || 1,
      timeBudgetFn: config.timeBudgetFn,
    });
    this.chunkGenerator = new ChunkGenerator(
      new HeightSampler(config.seed),
      this.asyncScheduler,
      this.boundaryEngine,
    );
    this.cache = new CacheSubsystem(config.cacheSize, this.boundaryEngine);
    this.deformation = new DeformationSystem(this.cache, this.chunkGenerator);
  }
}
```

### 1.2 Покадровый цикл update(camera)

```
update(camera: Camera) → void
  frameStartTime = performance.now()
  generatedThisFrame = 0

  // 0. Извлечь параметры камеры
  cameraParams = {
    position: camera.position.clone(),
    fovRadians: camera.fov,
    viewportWidthPx: scene.getEngine().getRenderWidth(),
    viewportHeightPx: scene.getEngine().getRenderHeight(),
    nearPlane: camera.minZ,
    farPlane: camera.maxZ,
  }

  // 1. LOD-оценка — обход дерева с LODEvaluator
  splitSignals: { node: QuadNode; evaluation: LODEvaluation }[] = []
  mergeSignals: { parent: QuadNode; children: QuadNode[] }[] = []
  nonVisibleNodes: QuadNode[] = []

  traverseTree(quadtree.getRoots(), cameraParams,
    onVisit = (node, eval) => {
      if node.state == 'split':
        // Продолжить обход детей
        return 'descend'

      if eval.shouldSplit:
        splitSignals.push({ node, evaluation: eval })
      else if node.state == 'virtual' AND eval.isVisible:
        // Лист требует генерации
        pendingLeaves.push({ node, isVisible: true, distance: eval.distance })
      else if node.state == 'virtual' AND not eval.isVisible:
        nonVisibleNodes.push(node)
    },
    onParent = (parent, childrenEvals) => {
      if parent.state == 'split' AND all children should merge:
        mergeSignals.push({ parent, children: parent.children })
      // Обновить isVisible/distance в кэше для всех loaded детей
      updateCacheVisibility(parent.children, childrenEvals)
    }
  )

  // 2. Split-ы (до merge)
  for each signal in splitSignals:
    if signal.node.depth < maxDepth:
      quadtree.split(signal.node)
      if DEBUG: ContractVerifier.checkSplitSeams(signal.node.children, ε_position)

  // 3. Merge-и
  for each signal in mergeSignals:
    quadtree.merge(signal.children)
    // Пометить кэш-записи как evictable
    for each child in signal.children:
      cache.markEvictable(child.id)

  // 4. Enforce max depth delta (BFS ripple)
  for each affected node:
    quadtree.enforceMaxDepthDelta(node)

  // 5. Генерация pending-листьев
  // Фаза 3a: сбор контрактов в детерминированном порядке
  sort(pendingLeaves, by face-major 0→5, then depth-minor, then tx/ty lexicographic)

  readyForGeometry = []
  for each leaf in pendingLeaves:
    contracts = {}
    allAvailable = true
    for each edge in [left, right, bottom, top]:
      neighbor = quadtree.getNeighborAtDepth(leaf.node, edge, leaf.node.depth)
      if neighbor AND neighbor.state == 'loaded':
        contracts[edge] = boundaryEngine.getContract(neighbor.id, oppositeEdge(edge))
      else if neighbor is null:
        contracts[edge] = null  // свободное ребро
      else:
        allAvailable = false    // сосед ещё не сгенерирован
    if allAvailable:
      readyForGeometry.push({ node: leaf.node, contracts })
    else:
      // Отложить до следующего кадра
      deferredToNextFrame.push(leaf)

  // Фаза 3b: генерация геометрии
  for each leaf in readyForGeometry:
    request = buildGenerateRequest(leaf.node, leaf.contracts, config)

    try:
      // Проверить кэш
      if cache.has(leaf.node.id):
        cache.touch(leaf.node.id)
        continue

      // Sync или async
      estimatedCost = estimateCost(leaf.node.depth, config.chunkResolution)
      if asyncScheduler.shouldUseSync(leaf.node.depth, estimatedCost):
        geometry = chunkGenerator.generateSync(request)
      else:
        // Async: поставить Promise, меш появится в следующем кадре
        cache.put(leaf.node.id, { state: 'generating', generationPromise:
          chunkGenerator.generateAsync(request).then(geometry => {
            mesh = chunkGenerator.buildMesh(geometry, scene, leaf.node.id)
            mesh.setParent(rootTransform)
            // Декларировать контракты
            for each edge:
              boundaryEngine.declare(leaf.node.id, edge, geometry)
            cache.put(leaf.node.id, { state: 'ready', mesh, geometry, ... })
          })
        })
        continue

      mesh = chunkGenerator.buildMesh(geometry, scene, leaf.node.id)
      mesh.setParent(rootTransform)

      // Декларировать контракты (BoundaryContractEngine, не ChunkGenerator)
      for each edge in [left, right, bottom, top]:
        boundaryEngine.declare(leaf.node.id, edge, geometry)

      // Кэшировать
      cache.put(leaf.node.id, {
        mesh, geometry, material: mesh.material,
        contracts: boundaryEngine.getContracts(leaf.node.id),
        state: 'ready', isVisible: leaf.isVisible,
        distanceFromCamera: leaf.distance,
      })

      // Верифицировать с соседями
      for each edge in [left, right, bottom, top]:
        neighbor = quadtree.getNeighborAtDepth(leaf.node, edge, leaf.node.depth)
        if neighbor AND neighbor.state == 'loaded':
          myContract = boundaryEngine.getContract(leaf.node.id, edge)
          neighborContract = boundaryEngine.getContract(neighbor.id, oppositeEdge(edge))
          boundaryEngine.createInterface(leaf.node.id, neighbor.id, edge)
          if DEBUG: ContractVerifier.checkContractMatch(myContract, neighborContract, ε_position)

      generatedThisFrame++

    catch (error):
      // R-016: cleanup при ошибке
      if mesh: mesh.dispose()
      if geometry?.material: geometry.material.dispose()
      console.error(`Failed to generate chunk ${leaf.node.id}:`, error)

  // 6. Очистка старых мешей после merge
  for each id in pendingCacheEvictions:
    cache.evictById(id)

  // 7. Вытеснение если кэш переполнен
  if cache.getSize() > config.cacheSize:
    // Приоритетное вытеснение: evictable → невидимые дальние → видимые LRU
    cache.evict(cache.getSize() - config.cacheSize)

  // 8. Профилирование
  frameTime = performance.now() - frameStartTime
  if frameTime > 16.6:  // превышен бюджет кадра
    console.warn(`PlanetRoot.update: frame time ${frameTime.toFixed(1)}ms`)
```

### 1.3 Обход дерева (traverseTree)

```
traverseTree(roots, cameraParams, onVisit, onParent):
  for each root in roots:
    traverseNode(root, cameraParams, onVisit, onParent)

traverseNode(node, cameraParams, onVisit, onParent):
  eval = lodEvaluator.evaluate(node, cameraParams)

  if not eval.isVisible AND node.state == 'virtual':
    // REQ-003: невидимые чанки тоже обрабатываются
    // но с меньшим приоритетом — только 1-2 уровня глубже
    if node.depth < cameraParams.maxOccludedDepth:
      onVisit(node, { ...eval, maxDepth: cameraParams.maxOccludedDepth })
    return

  action = onVisit(node, eval)

  if action == 'descend' AND node.state == 'split':
    childEvals = []
    for each child in node.children:
      childEval = traverseNode(child, cameraParams, onVisit, onParent)
      childEvals.push(childEval)
    onParent(node, childEvals)
```

### 1.4 getHeightAt

```
getHeightAt(worldPos: Vector3) → number:
  // Определить face и UV точки
  [face, u, v] = dirToUv(worldPos.normalize())

  // Найти лист квадродерева, содержащий эту UV-точку
  // Спуск от корня до листа
  node = quadtree.getRoot(face)
  while node.state == 'split':
    // Определить, в каком из 4 детей точка
    childIdx = uvToChildIndex(u, v, node.depth)
    node = node.children[childIdx]

  // Запросить интерполированную высоту
  if node.state == 'loaded':
    geometry = cache.get(node.id)?.geometry
    if geometry:
      return interpolateHeight(geometry, u, v, node.depth)
  // Fallback: прямой запрос к HeightSampler
  return heightSampler.getHeight(worldPos.x, worldPos.y, worldPos.z)
```

## 2. Структуры данных

```ts
interface PlanetConfig {
  planetRadius: number;          // default 6371
  seed: number;
  heightAmplitude: number;       // default 8
  maxDepth: number;              // default 12
  chunkResolution: number;       // default 16
  cacheSize: number;             // default 1000
  timeBudgetFn: (depth: number) => number;
}

class PlanetRoot {
  // 9 подсистем + config + scene + rootTransform
  constructor(config: PlanetConfig, scene: Scene);
  update(camera: Camera): void;
  getHeightAt(worldPos: Vector3): number;
  getQuadtreeSnapshot(): QuadtreeSnapshot;
  dumpContracts(): ContractReport[];
  dispose(): void;
}
```

**Memory footprint (без кэша):** ~2 KiB (подсистемы — лёгкие объекты, чистые структуры). Основная память — в CacheSubsystem.

## 3. Производительность

| Фаза | ~Time (типичный кадр) | Бюджет |
|------|----------------------|--------|
| CameraParams extraction | < 0.1 ms | — |
| LOD-оценка (1000 узлов) | ~5 ms | 30% |
| Split/merge + ripple | ~0.5 ms | 3% |
| Генерация (sync, 2-3 чанка) | ~30 ms | — (async для большинства) |
| Кэширование + контракты | ~0.5 ms | 3% |
| Очистка + eviction | ~0.5 ms | 3% |
| **Total (без генерации)** | **~7 ms** | **42% кадра** |

**Per-frame бюджет:** 8 ms из 16.6 ms (50% кадра). Остальное — рендеринг Babylon.js, FlightModel, управление.

**Генерация асинхронна для большинства чанков:**
- Sync только для малых глубин (depth 0–3), где estimatedCost < budget
- Async для всего остального через AsyncJobScheduler
- buildMesh ВСЕГДА на главном потоке (GPU upload)

## 4. Интеграция с Babylon.js

```ts
// PlanetRoot — единственный компонент, взаимодействующий со сценой напрямую:
import { Camera } from '@babylonjs/core/Cameras/camera';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Scene } from '@babylonjs/core/scene';

// Camera params extraction:
// camera.fov — vertical FOV in radians
// camera.minZ, camera.maxZ — near/far planes
// camera.position — world position
// scene.getEngine().getRenderWidth/Height() — viewport

// Создание root transform для floating origin:
// rootTransform = new TransformNode('planetRoot', scene)
// Все меши чанков parented к rootTransform

// При dispose:
// rootTransform.dispose() — каскадно освобождает все дочерние меши
```

## 5. Обработка ошибок

| Условие | Поведение |
|---------|-----------|
| Телепортация камеры (respawn) | `asyncScheduler.cancelAll()` — все pending-задания отменены |
| `planetRadius = 0` | Fallback к 1 |
| `maxDepth = 0` | Планета из 6 чанков, по одному на грань |
| `cacheSize = 0` | Каждый кадр генерировать заново (деградация, не падение) |
| Сцена остановлена | `update()` не вызывается, состояние сохраняется |
| `buildMesh` + `cache.put` бросает исключение | try/catch: `mesh.dispose()`, `material.dispose()` (R-016) |
| Все Worker-ы заняты | Задания в очереди AsyncJobScheduler |
| Кэш переполнен | Приоритетное вытеснение, видимые чанки не страдают |

## 6. Состояния

```
  [uninitialized] ──new PlanetRoot──→ [ready]
                                          │
                                          ├── update(camera) каждый кадр
                                          │   └── внутренние фазы 0→5
                                          │
                                          ├── пауза (сцена остановлена)
                                          │   └── update не вызывается
                                          │
                                          └── dispose() ──→ [disposed]
                                              ├── cache.dispose()
                                              ├── asyncScheduler.terminate()
                                              ├── rootTransform.dispose()
                                              └── все меши освобождены
```

## Ссылки

- Requirement spec: `docs/LOD/01-planet-root.md`
- Architecture: `docs/LOD-architecture.md`
- Владеет: всеми 9 подсистемами
