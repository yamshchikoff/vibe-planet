# Спецификация требований — BoundaryContractEngine

## 1. Назначение

Центральный механизм контрактного программирования чанков. Декларирует, хранит
и верифицирует граничные контракты для каждого ребра чанка. Обеспечивает
межконтрактный стык между чанками разных LOD-глубин.

## 2. Связь с родительской спецификацией

| Требование | Как удовлетворяется |
|------------|--------------------|
| LOD-REQ-GEN3 | declare, verify, createInterface, resample, revoke |
| LOD-REQ-GEN | Контрактное программирование: проверка C⁰/G¹ в verify |
| LOD-REQ-GEN3 (стохастический контракт) | Отложен — LOD-BC-006 |
| LOD-REQ-GEN3 (негеометрический) | Хранение timeBudget, memoryBudget, seed, contentType, patchIds |

## 3. Функциональные требования

### LOD-BC-001: Декларация контракта
**Приоритет:** high
**Статус:** реализовано

`declare(chunkId, edge, geometry, planetRadius, heightAmplitude, options?)`
создаёт EdgeContract для ребра чанка.

Из геометрии чанка извлекаются:
- **vertexPositions** — позиции вершин вдоль ребра (chunkResolution + 1 вершин,
  от угла к углу). Извлекаются из плоского Float32Array positions[].
  Индексы для каждого ребра при N = resolution + 1:
  - Top (row=0): col = 0..resolution → indices col
  - Bottom (row=resolution): col = 0..resolution → indices resolution*N + col
  - Left (col=0): row = 0..resolution → indices row*N
  - Right (col=resolution): row = 0..resolution → indices row*N + resolution
- **heightProfile** — нормализованные высоты рельефа в каждой вершине.
  Вычисляются из позиции: `h = (|position| - R) / H`, clamped [0, 1].
- **tangents** — тангенциальные векторы вдоль ребра. Вычисляются как
  центральные разности соседних vertexPositions вдоль ребра.
  Для endpoint-ов используется forward/backward difference.
- **guaranteedDepth** — число вершинных рядов внутрь чанка, согласованных с
  контрактом (по умолчанию 0; будет использоваться LOD-BC-005).

Resolution чанка определяется из positions.length: `N = sqrt(length / 3)`.

### LOD-BC-002: Верификация двух контрактов
**Приоритет:** high
**Статус:** реализовано

`verify(a, b, options?)` сравнивает два EdgeContract на соответствие:

- **C⁰:** позиции вершин совпадают с точностью ε_position (по умолч. 1e-6)
- **G¹:** тангенциальные векторы согласованы (угол между ними < ε_angle_deg,
  по умолч. 0.1°)
- **Консистентность профиля:** высоты совпадают с точностью ε_height (1e-6)

Если чанки на разных глубинах — более глубокий контракт ресемплируется к
глубине менее глубокого перед сравнением.

Возвращает `ContractVerificationResult` со списком нарушений и их типами.

### LOD-BC-003: Межконтрактный интерфейс
**Приоритет:** high
**Статус:** реализовано

`createInterface(chunkA, chunkB, edge)` создаёт InterContractEdge —
структуру, связывающую два контракта на общем ребре.

Если глубины различаются, `resampleMap` сопоставляет индексы вершин
более глубокого чанка индексам менее глубокого.

### LOD-BC-004: Ресемплирование контракта
**Приоритет:** high
**Статус:** реализовано

`resample(contract, targetDepth)` создаёт копию контракта, адаптированную под
другую LOD-глубину.

- При повышении глубины (d → d+k): factor = 2^k. Промежуточные вершины
  интерполируются (линейно для позиций, линейно для высот).
- При понижении глубины (d → d−k): factor = 2^k. Берётся каждое factor-е
  значение (decimation).

### LOD-BC-005: Гарантированная глубина
**Приоритет:** high
**Статус:** отложено

`verifyGuaranteedDepth(chunkId, contract)` — будет реализовано после
ContractVerifier.

### LOD-BC-006: Стохастическая верификация контракта
**Приоритет:** medium
**Статус:** отложено

Будет реализовано после накопления достаточного количества пар контрактов.

### LOD-BC-007: Отзыв контракта
**Приоритет:** high
**Статус:** реализовано

`revoke(chunkId)` удаляет все контракты чанка из хранилища. Вызывается при
merge и cache eviction. Если чанк не найден — no-op.

### LOD-BC-008: Негеометрические атрибуты
**Приоритет:** medium
**Статус:** реализовано

EdgeContract хранит негеометрические поля:
- **depth:** LOD-глубина чанка
- **guaranteedDepth:** 0 (заполняется LOD-BC-005)
- **g1Guarantee:** 'deterministic' | 'stochastic'
- **maxAngleDeg:** порог угла для G¹-верификации (по умолч. 0.1)
- **timeBudgetMs:** бюджет времени генерации
- **memoryBudgetBytes:** бюджет памяти чанка
- **seed:** детерминированный seed для регенерации
- **contentType:** семантический тип местности
- **patchIds:** список ID применённых deformation-патчей

## 4. Интерфейс

```ts
interface EdgeContract {
  chunkId: string;
  edge: 'left' | 'right' | 'bottom' | 'top';
  face: number;
  depth: number;
  vertexPositions: Vector3[];
  heightProfile: number[];
  tangents: Vector3[];
  guaranteedDepth: number;
  g1Guarantee: 'deterministic' | 'stochastic';
  maxAngleDeg: number;
  timeBudgetMs: number;
  memoryBudgetBytes: number;
  seed: number;
  contentType: string;
  patchIds: string[];
}

interface ContractVerificationResult {
  passed: boolean;
  failures: ContractFailure[];
}

interface ContractFailure {
  type: 'position' | 'height' | 'tangent' | 'guaranteedDepth' | 'stochastic';
  severity: 'error' | 'warning';
  edgeVertexIndex: number;
  delta: number;
}

interface InterContractEdge {
  edge: Edge;
  chunkA: EdgeContract;
  chunkB: EdgeContract;
  resampleMap: number[];
  verified: boolean;
}

class BoundaryContractEngine {
  constructor();
  declare(
    chunkId: string, edge: Edge, geometry: ChunkGeometry,
    planetRadius: number, heightAmplitude: number,
    options?: { depth?: number },
  ): EdgeContract;
  verify(
    a: EdgeContract, b: EdgeContract,
    options?: { epsPosition?: number; epsAngleDeg?: number },
  ): ContractVerificationResult;
  createInterface(chunkA: EdgeContract, chunkB: EdgeContract, edge: Edge): InterContractEdge;
  resample(contract: EdgeContract, targetDepth: number): EdgeContract;
  revoke(chunkId: string): void;
  getContract(chunkId: string, edge: Edge): EdgeContract | undefined;
  getAllContracts(chunkId: string): EdgeContract[];
}
```

## 5. Краевые случаи

- **Сосед не существует (null-контракт):** ребро без контракта — генератор
  свободен, верификация не требуется
- **Разница глубин > 2:** resample работает для любой разницы (step = 2^k)
- **Пустой контракт:** все поля инициализированы, массив vertexPositions пустым
  быть не может (минимум 2 вершины на ребре — RES=1)
- **H=0 (сфера):** heightProfile = [0] для всех вершин (деление на 0 избегается)
- **Revoke несуществующего:** no-op

## 6. Зависимости

Babylon.js (тип Vector3). ContractVerifier — отложен (будет подключён в verify
для DEBUG-проверок).

## 7. Стратегия тестирования

- **Declare + Verify:** сгенерировать четыре ребра geometry → declare контракты
  → verify возвращает passed для пар смежных рёбер
- **Cross-LOD verify:** чанк d и сосед d+1 → resample → verify passed
- **Умышленное нарушение:** изменить позицию вершины в vertexPositions → verify
  возвращает failed с типом 'position'
- **Revoke:** после revoke, попытка verify с отозванным контрактом → отсутствие
  в store (verify работает с переданными объектами, не из store)
- **Resample:** up-resample проверяет количество и интерполированные значения;
  down-resample проверяет decimation

## 8. Алгоритмы

### 8.1 Edge extraction

Для ChunkGeometry с positions (Float32Array длины N² × 3), N = resolution + 1:

```
top edge:    indices 0 .. RES           → positions[i*3..i*3+2]
bottom edge: indices RES*N .. RES*N+RES → positions[i*3..i*3+2]
left edge:   indices 0, N, 2N, ..., RES*N
right edge:  indices RES, N+RES, 2N+RES, ..., RES*N+RES
```

### 8.2 Height profile

Для каждой вершины p = (x, y, z):
```
distance = sqrt(x² + y² + z²)
h = (distance - R) / H
h_clamped = max(0, min(1, h))
```

### 8.3 Tangent computation

Для массива positions[] длины M (M = resolution + 1):
```
tangent[0] = normalize(positions[1] - positions[0])
tangent[M-1] = normalize(positions[M-1] - positions[M-2])
tangent[i] = normalize(positions[i+1] - positions[i-1])
```

### 8.4 Resampling

Down-resample (d → d - k), factor = 2^k:
```
for i in 0..floor((M-1)/factor):
  result[i] = source[i * factor]
```

Up-resample (d → d + k), factor = 2^k, M' = (M - 1) * factor + 1:
```
for i in 0..M-2:
  a = source[i], b = source[i+1]
  for j in 0..factor-1:
    t = j / factor
    result[i * factor + j] = lerp(a, b, t)
result[(M-1) * factor] = source[M-1]
```

ResampleMap: для deeper → shallower, map[deeperIndex] = shallowerIndex.

## 9. Architectural Decisions

| Решение | Альтернатива | Обоснование |
|---------|-------------|-------------|
| Tangent = diff positions | uvToDirTangent | Tangent вдоль ребра учитывает рельеф; uvToDirTangent — только геометрию сферы |
| declare принимает R/H извне | Хранить в geometry | geometry не содержит параметров генерации; heightProfile нельзя восстановить без R/H |
| Vector3[] в контрактах | Flat number[] | Удобство в тестах/коде; при worker-transfer → flat array на boundary |
| Auto-resample в verify | Требовать одинаковую depth | Прозрачность для caller; единый контракт verify |
| Хранилище Map<chunkId, Map<Edge, ...>> | Плоский Map | Группировка по чанку для revoke и getAllContracts |
| verify работает с объектами (не из store) | verify ищет в store | Позволяет верифицировать произвольные пары, в т.ч. после revoke |
