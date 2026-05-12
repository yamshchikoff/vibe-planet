# LOD Chunk System — Архитектура верхнего уровня

Настоящий документ определяет верхнеуровневую архитектуру системы LOD-чанков,
реализующей требования спецификации `docs/LOD-chunk-system.md`. Документ
описывает КАК система устроена на уровне компонентов и их взаимодействия.

Архитектура спроектирована с чистого листа (предыдущая реализация LOD отключена
после миграции на Babylon.js) и базируется исключительно на требованиях
спецификации.

## 1. Диаграмма компонентов

```
┌─────────────────────────────────────────────────────────────────┐
│                     PlanetRoot (Facade)                          │
│   update(camera), getHeightAt(worldPos), dispose()              │
│   Удовлетворяет: REQ-001, REQ-002, REQ-003 (оркестрация)        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
         ▼                  ▼                  ▼
┌────────────────┐ ┌───────────────┐ ┌──────────────────────┐
│ QuadtreeManager│ │ LODEvaluator  │ │BoundaryContractEngine│
│ (логическое    │ │ (screen-space │ │(декларация,          │
│  дерево, split/│ │  error, 1px)  │ │ верификация,         │
│  merge)        │ │               │ │ межконтрактный       │
│                │ │               │ │ интерфейс)           │
└───────┬────────┘ └──────┬────────┘ └─────────┬────────────┘
        │                 │                   │
        └─────────────────┼───────────────────┘
                          │
               ┌──────────┼──────────┐
               │          │          │
               ▼          ▼          ▼
      ┌────────────┐ ┌──────────┐ ┌────────────────┐
      │ChunkGenrtor│ │CacheSubsy│ │AsyncJobSchedlr │
      │(геометрия, │ │(LRU,     │ │(Web Worker,    │
      │ нормали,   │ │ write-th │ │ sync fallback) │
      │ цвета)     │ │ дифф-хр) │ │                │
      └─────┬──────┘ └──────────┘ └───────┬────────┘
            │                             │
            ▼                             │
      ┌────────────┐                      │
      │HeightSampl │◄─────────────────────┘
      │(FBM,ridged)│  (выгружается в Worker)
      └────────────┘

┌───────────────────┐  ┌──────────────────────┐
│ PolarTopology     │  │ DeformationSystem    │
│ Handler           │  │ (будущее: патчи,     │
│ (±Y edge sync,    │  │  дифф-хранение)      │
│  схождение в      │  │                      │
│  точке полюса)    │  │                      │
└───────────────────┘  └──────────────────────┘

          Все компоненты отчитываются перед
          ContractVerifier (только DEBUG)
```

### Правила взаимодействия

- **PlanetRoot** — единственная точка входа. Владеет всеми подсистемами,
  вызывает `update(cameraPos)` каждый кадр.
- **QuadtreeManager** владеет логическим деревом (без геометрии). Вызывает
  **LODEvaluator** для получения сигналов split/merge и
  **BoundaryContractEngine** для валидации операций.
- **ChunkGenerator** читает контракты соседей из **BoundaryContractEngine** и
  данные высот из **HeightSampler**, производит `VertexData`. Может делегировать
  FBM-сэмплирование **AsyncJobScheduler**.
- **CacheSubsystem** хранит сгенерированные чанки. **DeformationSystem** пишет
  через кэш (write-through).
- **ContractVerifier** — сквозной DEBUG-модуль. Каждый компонент вызывает его
  проверки в точках энфорсмента.

## 2. Перечень компонентов

### 2.1 PlanetRoot (Facade)

**Ответственность:** Владение жизненным циклом всех LOD-подсистем, выполнение
покадрового цикла: сбор параметров камеры → оценка LOD → split/merge →
генерация → кэширование → присоединение мешей к сцене.
Принимает Babylon.js `Camera`, из которой извлекаются позиция, FOV, viewport —
параметры, необходимые для вычисления screen-space размера чанка.

**Ключевой интерфейс:**
```ts
class PlanetRoot {
  constructor(config: PlanetConfig, scene: Scene);
  update(camera: Camera): void;
  getHeightAt(worldPosition: Vector3): number;
  getQuadtreeSnapshot(): QuadtreeSnapshot;   // для тестов
  dumpContracts(): ContractReport[];         // для отладки
  dispose(): void;
}
```

**Зависимости:** QuadtreeManager, LODEvaluator, ChunkGenerator, CacheSubsystem,
BoundaryContractEngine, PolarTopologyHandler, ContractVerifier.

### 2.2 QuadtreeManager

**Ответственность:** Ведение логического квадродерева на 6 гранях кубической
сферы, выполнение split/merge операций, энфорсмент инварианта: разница глубин
соседних чанков не превышает 1. Чистое дерево — не владеет геометрией и не
выполняет обход (traversal). Обход (traverseVisible / traverseOccluded)
выполняется PlanetRoot, который владеет и QuadtreeManager, и LODEvaluator.

**Ключевой интерфейс:**
```ts
class QuadtreeManager {
  constructor(maxDepth: number);
  getRoots(): QuadNode[];
  split(node: QuadNode): QuadNode[];
  merge(children: QuadNode[]): QuadNode;
  getNeighbor(node: QuadNode, edge: Edge): QuadNode | null;
  getNeighborAtDepth(node: QuadNode, edge: Edge, targetDepth: number): QuadNode | null;
  enforceMaxDepthDelta(node: QuadNode): void;
}
```

**Зависимости:** PolarTopologyHandler (для cross-face neighbour-ов).

### 2.3 LODEvaluator

**Ответственность:** Вычисление screen-space размера узла квадродерева в
пикселях и генерация булевых сигналов split/merge на основе 1px-порога.

**Ключевой интерфейс:**
```ts
class LODEvaluator {
  constructor(planetRadius: number);
  evaluate(node: QuadNode, camera: CameraParams): LODEvaluation;
  evaluateBatch(nodes: QuadNode[], camera: CameraParams): Map<string, LODEvaluation>;
  getSplitThreshold(depth: number): number;
  getMergeThreshold(depth: number): number;
  isAboveHorizon(chunkCenter: Vector3, cameraPosition: Vector3, planetRadius: number): boolean;
}
```

**Зависимости:** Нет (чистая математика).

### 2.4 BoundaryContractEngine

**Ответственность:** Декларация, хранение и верификация граничных контрактов
для каждого ребра чанка. Обеспечивает межконтрактный стык между чанками
разных LOD-глубин. Центральный механизм C⁰ и G¹ непрерывности.
Контракт явно указывает тип G¹-гарантии: `g1Guarantee: 'deterministic' |
'stochastic'` (см. LOD-chunk-system.md §3.2).

**Ключевой интерфейс:**
```ts
class BoundaryContractEngine {
  declare(chunkId: string, edge: Edge, geometry: ChunkGeometry): EdgeContract;
  verify(a: EdgeContract, b: EdgeContract): ContractVerificationResult;
  createInterface(chunkAId: string, chunkBId: string, edge: Edge): InterContractEdge;
  resample(contract: EdgeContract, targetDepth: number): EdgeContract;
  verifyGuaranteedDepth(chunkId: string, contract: EdgeContract): boolean;
  verifyStochasticContract(contracts: EdgeContract[], sampleSize: number): StochasticResult;
  revoke(chunkId: string): void;
}
```

**Зависимости:** Нет (чистая геометрия).

### 2.5 ChunkGenerator

**Ответственность:** Генерация полной геометрии чанка (positions, normals,
colors, indices, PBR) с соблюдением граничных контрактов соседей.

**Ключевой интерфейс:**
```ts
class ChunkGenerator {
  constructor(heightSampler: HeightSampler, asyncScheduler: AsyncJobScheduler);
  generateSync(request: GenerateRequest): ChunkGeometry;
  generateAsync(request: GenerateRequest): Promise<ChunkGeometry>;
  generate(request: GenerateRequest): Promise<ChunkGeometry>;
  buildMesh(geometry: ChunkGeometry, scene: Scene, name: string): Mesh;
  static verifyRoundTrip(sampler: HeightSampler, request: GenerateRequest): boolean;
}
```

**Зависимости:** HeightSampler, BoundaryContractEngine, AsyncJobScheduler.

### 2.6 HeightSampler

**Ответственность:** Детерминированное 3D value-noise FBM и ridged multifractal
сэмплирование высот. Предоставляет синхронный и Worker-прокси интерфейсы.

**Ключевой интерфейс:**
```ts
class HeightSampler {
  constructor(seed: number);
  getHeight(x: number, y: number, z: number): number;
  getBiomeWarp(x: number, y: number, z: number, octaves: number): number;
  getMountainMask(x: number, y: number, z: number): number;
  sampleBatch(points: Float32Array): Float32Array;
  getWorkerProxy(): HeightSamplerWorkerProxy;
}
```

**Зависимости:** Нет (чистая математика).

### 2.7 CacheSubsystem

**Ответственность:** LRU-кэш сгенерированных чанков с write-through поддержкой
для deformation-патчей. Дифф-хранение (не полная копия геометрии) для патчей.

**Ключевой интерфейс:**
```ts
class CacheSubsystem {
  constructor(maxSize: number);
  get(chunkId: string): ChunkCacheEntry | undefined;
  put(chunkId: string, entry: ChunkCacheEntry): void;
  has(chunkId: string): boolean;
  touch(chunkId: string): void;
  writePatch(chunkId: string, patch: DeformationPatch): void;
  evict(count: number): string[];
  getSize(): number;
  getMaxSize(): number;
  getPatches(chunkId: string): DeformationPatch[];
  getBaseGeometry(chunkId: string): ChunkGeometry | undefined;
  dispose(): void;
}
```

**Зависимости:** Нет (чистая структура данных).

### 2.8 AsyncJobScheduler

**Ответственность:** Управление пулом Web Workers для выгрузки FBM-сэмплирования
и построения буферов. Принимает решение sync/async на основе временного
бюджета N(d).

**Ключевой интерфейс:**
```ts
class AsyncJobScheduler {
  constructor(options: { workerCount: number; timeBudgetFn: (d: number) => number });
  scheduleHeightSampling(request: HeightSampleRequest): JobTicket<HeightSampleResponse>;
  shouldUseSync(depth: number, estimatedCostMs: number): boolean;
  cancelAll(): void;
  terminate(): void;
  getStats(): { pending: number; completed: number; avgTimeMs: number };
}
```

**Зависимости:** HeightSampler (владеет Worker-экземплярами внутри).

### 2.9 PolarTopologyHandler

**Ответственность:** Обработка топологической сингулярности на полюсах (faces
±Y). Обеспечивает схождение 4 рёбер полярного чанка в точке полюса и
соответствие контрактам 4 экваториальных граней.

**Ключевой интерфейс:**
```ts
class PolarTopologyHandler {
  getEquatorialFaces(polarFace: number): number[];
  getEdgeMapping(polarFace: number, polarEdgeIndex: number): PolarEdgeMapping;
  verifyPoleConvergence(polarContracts: EdgeContract[], epsilon: number): PoleConvergenceResult;
  resolvePolarNeighbor(polarNode: QuadNode, polarEdge: Edge, depth: number): NeighborRef;
  generateRadialGrid(resolution: number, faceSign: number): PolarGrid;
}
```

**Зависимости:** BoundaryContractEngine (для верификации в точке полюса).

### 2.10 DeformationSystem (будущее)

**Ответственность:** Управление персистентными deformation-патчами (кратеры,
строительство, тоннели). Write-through в кэш и дифф-хранение.

**Ключевой интерфейс:**
```ts
class DeformationSystem {
  applyPatch(patch: DeformationPatch): void;
  getPatchesForChunk(chunkId: string): DeformationPatch[];
  reconstruct(chunkId: string, baseGeometry: ChunkGeometry): ChunkGeometry;
  serializePatches(): ArrayBuffer;
  deserializePatches(data: ArrayBuffer): void;
  isRoundTripValid(chunkId: string): boolean;
}
```

**Зависимости:** CacheSubsystem, ChunkGenerator.

### 2.11 ContractVerifier (сквозной, только DEBUG)

**Ответственность:** Централизованный движок утверждений. Все проверки
инвариантов проходят через этот модуль. В production — no-op.

**Ключевой интерфейс:**
```ts
class ContractVerifier {
  static checkRadialDistance(geometry: ChunkGeometry, R: number, maxH: number): void;
  static checkVertexCount(geometry: ChunkGeometry, resolution: number): void;
  static checkNormals(geometry: ChunkGeometry): void;
  static checkFaceOrigin(geometry: ChunkGeometry, face: number): void;
  static checkSplitSeams(children: ChunkGeometry[], tolerance: number): void;
  static checkExternalPerimeter(children: ChunkGeometry[], contracts: EdgeContract[], eps: number): void;
  static checkRoundTrip(original: ChunkGeometry, reconstructed: ChunkGeometry, eps: number): void;
  static checkContractMatch(a: EdgeContract, b: EdgeContract, eps: number): void;
  static checkLODCoherence(parent: ChunkGeometry, children: ChunkGeometry[], eps: number): void;
  static checkCrossFaceContinuity(a: ChunkGeometry, b: ChunkGeometry, edge: SharedEdge, eps: number): void;
}
```

**Зависимости:** Нет (вызывается всеми компонентами).

## 3. Data Flow: путь чанка от несуществующего до отрендеренного

### Фаза 0: Движение камеры

```
camera изменяется → PlanetRoot.update(camera)
  → PlanetRoot извлекает camera.position, camera.fov, viewport
  → формирует CameraParams для LODEvaluator
```

### Фаза 1: LOD-оценка

```
PlanetRoot выполняет:
  cameraParams = { position: camera.position, fovRadians: camera.fov,
                   viewportWidthPx, viewportHeightPx, nearPlane, farPlane }

  PlanetRoot.traverseVisible(root, cameraParams)    // обход видимых узлов
  PlanetRoot.traverseOccluded(root, cameraParams)   // REQ-003 — невидимые узлы
    → для каждого посещённого узла:
        LODEvaluator.evaluate(node, cameraParams)
          → LODEvaluation { screenSizePx, shouldSplit, shouldMerge, isVisible }
```

Обход дерева (traverseVisible / traverseOccluded) выполняется PlanetRoot,
который владеет и QuadtreeManager, и LODEvaluator. Это позволяет PlanetRoot
отличать видимые чанки от невидимых без передачи LODEvaluator в QuadtreeManager.

### Фаза 2: Принятие решений split/merge

```
PlanetRoot собирает все сигналы:

  Для каждого листа где shouldSplit:
    QuadtreeManager.split(node) → создаёт 4 дочерних QuadNode
      → EP1: ContractVerifier.checkSplitSeams(children, ...)

  Для каждого родителя где shouldMerge:
    QuadtreeManager.merge(children) → восстанавливает родительский QuadNode
    ChunkGenerator.generate(parent) → пересоздаёт родителя
      → EP2: ContractVerifier.checkRoundTrip(original, regenerated)

  Для любого узла с depthDelta > 1 относительно соседа:
    → принудительный split менее глубокого соседа (ripple enforcement)
```

### Фаза 3: Разрешение контрактов и генерация

#### Фаза 3a: Сбор контрактов для pending-листьев

Детерминированный порядок обхода: face-major (0→5), depth-minor (возрастание),
tx/ty lexicographic. Это гарантирует, что сосед «слева» (меньший tx) и сосед
«снизу» (меньший ty) обработаны раньше.

```
Для каждого pending-листа в детерминированном порядке:

  PlanetRoot запрашивает контракты соседей через BoundaryContractEngine:
    Для каждого ребра (left, right, bottom, top):
      neighbor = QuadtreeManager.getNeighborAtDepth(node, edge, node.depth)
      if neighbor существует и его контракт уже задекларирован:
        contract = BoundaryContractEngine.getContract(neighbor.chunkId, oppositeEdge)

  Если у листа есть все доступные контракты соседей (или соседи отсутствуют):
    → лист помечается ready-for-geometry
```

#### Фаза 3b: Генерация геометрии

```
Для каждого листа, помеченного ready-for-geometry:

  Генерация (sync или async — см. Фазу 4).
  После генерации — BoundaryContractEngine.declare(chunkId, edge, geometry)
  для каждого из 4 рёбер (см. Фазу 5).

  Если лист не ready-for-geometry (отсутствует контракт соседа):
    → отложить до следующего кадра, когда сосед сгенерирует контракт.
```

ChunkGenerator производит ТОЛЬКО геометрию (positions, normals, colors, indices).
BoundaryContractEngine на фазе 5 извлекает контракты из готовой геометрии —
независимо от того, были рёбра вычислены из контракта соседа (contract-first)
или из HeightSampler (свободное ребро).

Для полярных чанков (face ±Y):
  PolarTopologyHandler.verifyPoleConvergence(polarContracts, eps)
    → EP3

В процессе генерации каждого листа (фаза 3b):

  CacheSubsystem.has(chunkId)?
    HIT:  touch entry, вернуть кэшированный mesh. ГОТОВО.
    MISS: продолжить.

  AsyncJobScheduler.shouldUseSync(depth, estimatedCost):
    SYNC:  ChunkGenerator.generateSync(request) → ChunkGeometry
    ASYNC: ChunkGenerator.generateAsync(request) → Promise<ChunkGeometry>
           (FBM-сэмплирование выгружено в Web Worker)

  Генерация:
    - Рёберные вершины зажимаются под контракты соседей (resample)
    - HeightSampler.getHeight(x,y,z) для каждой внутренней вершины
    - Нормали: центральные разности с contract-aware boundary treatment
    - Цвета: биомное отображение с domain warp

  DeformationSystem.reconstruct(chunkId, baseGeometry) — применяет патчи
    (будущее — сейчас no-op)

  Пост-генерационные проверки:
    → EP4: ContractVerifier.checkRadialDistance / checkVertexCount /
           checkNormals / checkFaceOrigin

### Фаза 4: Кэширование и построение меша

```
  ChunkGenerator.buildMesh(geometry, scene, name) → Mesh + PBRMaterial
  BoundaryContractEngine.declare(chunkId, edge, geometry)
    → 4 EdgeContract для этого чанка
    → EP5

  Для каждого соседа:
    BoundaryContractEngine.verify(thisContract, neighborContract)
      → EP6: ContractVerifier.checkContractMatch()

  CacheSubsystem.put(chunkId, { mesh, geometry, material, contracts, ... })
  mesh.setParent(planetRoot.getRootTransformNode())

  Если кэш переполнен:
    CacheSubsystem.evict(N) — приоритеты вытеснения:
      1. evictable (явно помеченные после merge)
      2. Невидимые (за горизонтом / вне frustum), дальние от камеры
      3. Видимые, наименее недавно использованные
    Видимый чанк никогда не вытесняется, если в кэше есть невидимые.
    → EP9: mesh.dispose(), BoundaryContractEngine.revoke()

  PlanetRoot оборачивает buildMesh + CacheSubsystem.put в try/catch:
    при исключении — mesh.dispose(), material.dispose() для предотвращения
    утечки ресурсов
```

### Фаза 5: Очистка

```
  Старые меши (от merge или eviction) освобождаются:
    mesh.dispose(), material.dispose()
  Старые контракты отзываются:
    BoundaryContractEngine.revoke(oldChunkId)
```

## 4. Точки энфорсмента контрактов

Все точки энфорсмента — вызовы `ContractVerifier.check*()`, обёрнутые в
`if (DEBUG)`. В production — dead-code elimination.

| EP# | Фаза | Проверка | Инвариант | Откуда вызывается |
|-----|------|----------|-----------|-------------------|
| EP1 | Split | 4 дочерних чанка непрерывны на внутренних стыках (C⁰, высоты) | I5 | QuadtreeManager.split() post-condition |
| EP2 | Merge | Round-trip: восстановленный parent == исходный pre-split parent | I7 | ChunkGenerator.generate() после merge |
| EP3 | Contract | Схождение в полюсе: 4 полярных ребра встречаются в одной точке | I10 | PolarTopologyHandler при генерации полярного чанка |
| EP4 | Generate | Радиальное расстояние, число вершин, нормали, face origin | I1–I4 | ChunkGenerator.generateSync() post-condition |
| EP5 | Contract | Ребёрный контракт задекларирован: самосогласованность positions, heights, tangents | I8 | BoundaryContractEngine.declare() |
| EP6 | Contract | Контракты соседей совпадают: C⁰ позиций, G¹ тангентов, консистентность профиля высот | I8 | BoundaryContractEngine.verify() для каждой пары соседей |
| EP7 | Split | Внешний периметр 4 детей == периметр родителя (непрерывность с соседями) | I6 | После генерации всех 4 детей, до удаления родительского меша |
| EP8 | LOD eval | Разница глубин любых соседних узлов ≤ 1 | REQ-003 | QuadtreeManager.enforceMaxDepthDelta() после каждого цикла split/merge |
| EP9 | Cache | При eviction: контракт отозван, меш disposed, нет висячих ссылок | I1–I4 | CacheSubsystem.evict() |
| EP10 | Deform | Патч применён корректно: геометрия проходит I1–I4 (кроме round-trip) | I7 (искл) | DeformationSystem.applyPatch() post-condition (будущее) |

### Стохастический контракт (вероятностная релаксация G¹)

Для фрактальных поверхностей, где G¹ не может быть гарантирована
детерминированно, используется стохастический контракт (вероятностная
релаксация G¹). ContractVerifier выполняет статистическое сэмплирование:

- Сэмплирует N случайных пар рёбер на разных глубинах, гранях, seed-ах
- Измеряет угол тангенциального отклонения в каждой общей вершине
- Утверждает: среднее отклонение ≈ 0, дисперсия в пределах порога,
  отсутствие систематического смещения по граням и глубинам
- Проверяет: ни одно измерение не превышает максимальный угол разрыва
  (worst-case bound, например ≤ 5°)

Тип контракта явно указан в поле `g1Guarantee` интерфейса `EdgeContract`:
`'deterministic'` или `'stochastic'`.

## 5. Ключевые архитектурные решения

### A. Разделение логического дерева и геометрии

QuadtreeManager владеет только структурами QuadNode (face, depth, tx, ty,
neighbour refs). Никакая геометрия в дереве не хранится. Это позволяет:

- Принимать решения split/merge без доступа к геометрии
- Кэшу быть единственным владельцем мешей
- При eviction — соответствующий QuadNode остаётся в дереве (state: loaded →
  virtual)

### B. Contract-first генерация

При генерации чанка C в позиции (face, d, tx, ty) генератор сначала
запрашивает EdgeContract всех существующих соседей. Рёберные вершины C не
вычисляются из шума — они сэмплируются напрямую из контракта соседа через
`resample()`. Только внутренние вершины вычисляются через HeightSampler.

Это гарантирует C⁰ непрерывность независимо от разницы LOD-глубин.

### C. Экспоненциальные параметры (REQ-002)

Пороги split и merge — экспоненциальные функции глубины:

```
splitThreshold(d)  ≈ 1.0 + splitBias  * exp(-d / splitDecay)
mergeThreshold(d)  ≈ 1.0 - mergeBias  * exp(-d / mergeDecay)
```

- На малой глубине (d = 0–3): широкий гистерезис (split при ~1.5 px,
  merge при ~0.7 px) — предотвращает джиттер на крупных масштабах
- На большой глубине (d = 8–12): жёсткая сходимость к 1.0 px — предотвращает
  pop-in на мелких масштабах
- Робастность на любых скоростях без адаптации к скорости: быстрое приближение
  пересекает пороги быстрее, но экспоненциальная форма гарантирует
  пропорциональность окна возможностей мировому размеру чанка

### D. Ripple split для инварианта глубины

Когда узел расщепляется (d → d+1), все соседи на глубине d проверяются. Если
сосед на глубине d−1 (на уровень выше), он принудительно расщепляется до
глубины d перед финализацией новых детей. Это распространяется ripple-эффектом
и завершается из-за ограничения maxDepth. Обычно 2–3 итерации.

### E. Полярная топология как контракт, а не специальный случай

PolarTopologyHandler — тонкий mapper: предоставляет корректные neighbour refs
для рёбер граней ±Y (которые охватывают 4 экваториальные грани) и проверяет
сходимость в точке полюса. Никакого механизма «полярной шапки».

Полярный чанк на depth d грани +Y декларирует 4 ребёрных контракта, каждый
совпадает с одним из 4 экваториальных соседей (на гранях ±X, ±Z). Точка полюса —
общая вершина, где сходятся все 4 ребра; контракт требует идентичности позиций
всех 4 рёбер в этой точке.

### F. Логика async dispatch

PROFILE first, ASYNC second. Метод `AsyncJobScheduler.shouldUseSync(depth,
estimatedCostMs)` использует правило: если `estimatedCostMs < timeBudgetNs(depth)`,
генерация синхронна на главном потоке. Если бюджет будет превышен — FBM-
сэмплирование выгружается в Web Worker.

Построение меша (`VertexData.applyToMesh`) всегда на главном потоке (GPU-bound,
не CPU-bound). Worker производит только сырые `Float32Array` буферы, которые
передаются (transfer, не copy) обратно в главный поток.

## 6. Typestate жизненного цикла QuadNode

```
   [virtual] — узел существует, геометрия не генерировалась
       │
       ├── LODEvaluator: shouldSplit → созданы 4 ребёнка (не сгенерированы)
       │
       ▼
   [split] — узел имеет 4 детей, собственная геометрия НЕ генерируется
       │
       ├── LODEvaluator: shouldMerge → дети уничтожены, узел → [virtual]
       │
       ▼
   [virtual]
       │
       ├── split не нужен, но геометрия НУЖНА (листовой узел)
       │
       ▼
   [loaded] — ChunkGeometry сгенерирован + закэширован + меш в сцене
       │
       ├── LODEvaluator: shouldSplit → меш disposed, узел → [split]
       ├── neighbour split ripple → принудительный split → [split]
       ├── cache eviction → меш disposed → [virtual]
       │
       ▼
   [disposed] — планета уничтожена
```

## 7. Покомпонентные спецификации требований

На каждый компонент настоящей архитектуры разработана отдельная спецификация
требований:

| # | Компонент | Документ |
|---|-----------|----------|
| 1 | PlanetRoot | `LOD/01-planet-root.md` |
| 2 | QuadtreeManager | `LOD/02-quadtree-manager.md` |
| 3 | LODEvaluator | `LOD/03-lod-evaluator.md` |
| 4 | BoundaryContractEngine | `LOD/04-boundary-contract.md` |
| 5 | ChunkGenerator | `LOD/05-chunk-generator.md` |
| 6 | HeightSampler | `LOD/06-height-sampler.md` |
| 7 | CacheSubsystem | `LOD/07-cache-subsystem.md` |
| 8 | AsyncJobScheduler | `LOD/08-async-scheduler.md` |
| 9 | PolarTopologyHandler | `LOD/09-polar-topology.md` |
| 10 | DeformationSystem | `LOD/10-deformation.md` |
| 11 | ContractVerifier | `LOD/11-contract-verifier.md` |

## 8. Связанные документы

| Документ | Связь |
|----------|-------|
| `docs/LOD-chunk-system.md` | Спецификация требований — источник всех LOD-REQ-* |
| `docs/interview-LOD-spec.md` | Протокол интервью — архитектурные решения |
| `docs/LOD-review-remarks.md` | Архитектурное ревью — замечания и несогласованности |
| `docs/architecture.md` | Место LODPlanet в архитектуре движка |
