# Техническая спецификация — BoundaryContractEngine

## 1. Алгоритмы

### 1.1 Декларация контракта (declare)

```
declare(chunkId, edge, geometry) → EdgeContract
  // Извлечь рёберные вершины из геометрии чанка
  // edge ∈ {left, right, bottom, top}
  // Геометрия: сетка (resolution+1) × (resolution+1)

  vertexIndices = getEdgeIndices(edge, resolution)
  // left:   i ∈ [0, resolution], row=0     → 0, 1, 2, ..., resolution
  // right:  i ∈ [0, resolution], row=res   → N-1, N-2, ..., N-resolution-1
  // bottom: i ∈ [0, resolution], col=0     → 0, stride, 2*stride, ...
  // top:    i ∈ [0, resolution], col=res   → res, res+stride, res+2*stride, ...

  vertexPositions = geometry.positions[vertexIndices]
  heightProfile = extractHeights(vertexPositions, planetRadius)
  tangents = computeTangents(vertexPositions)  // численное дифф-е вдоль ребра

  // Гарантированная глубина: число рядов вершин внутрь чанка,
  // согласованных с контрактом. Для contract-first генерации = 2
  // (два ряда от границы используют контракт соседа)
  guaranteedDepth = geometry.guaranteedDepth ?? 2

  // Тип G¹ гарантии
  g1Guarantee = edgeHasNeighborContract(edge, geometry.contracts)
    ? 'deterministic'   // рёбра из контракта соседа — G¹ гарантирована
    : 'stochastic'      // свободные рёбра из FBM — G¹ стохастическая

  maxAngleDeg = g1Guarantee === 'stochastic' ? 5.0 : 0.0

  return {
    chunkId, edge, face: geometry.face, depth: geometry.depth,
    vertexPositions, heightProfile, tangents,
    guaranteedDepth, g1Guarantee, maxAngleDeg,
    timeBudgetMs: N(geometry.depth),
    memoryBudgetBytes: computeMemoryBudget(geometry.resolution),
    seed: geometry.seed,
    contentType: geometry.contentType,
    patchIds: geometry.patchIds ?? [],
  }
```

`extractHeights`: для каждой рёберной вершины `|pos| − R` даёт абсолютную высоту; массив нормализуется делением на `heightAmplitude`.

`computeTangents`: центральные разности позиций вдоль ребра. Для внутренних точек — `(pos[i+1] − pos[i−1]) / 2`. Для крайних (`i=0`, `i=resolution`) — односторонние разности.

### 1.2 Верификация двух контрактов (verify)

```
verify(a: EdgeContract, b: EdgeContract) → ContractVerificationResult
  failures = []

  // Если глубины различаются — ресемплировать более глубокий к меньшему
  if a.depth != b.depth:
    deeper = a.depth > b.depth ? a : b
    shallower = a.depth > b.depth ? b : a
    deeperResampled = resample(deeper, shallower.depth)
    return verify(shallower, deeperResampled)

  // Оба контракта на одной глубине
  vertexCount = resolution + 1
  for i = 0 to vertexCount - 1:
    // C⁰: проверка позиций
    deltaPos = |a.vertexPositions[i] − b.vertexPositions[i]|
    if deltaPos > ε_position (0.001):
      failures.add({ type: 'position', edgeVertexIndex: i, delta: deltaPos })

    // G¹: проверка тангенциальных векторов
    angleDeg = angleBetween(a.tangents[i], b.tangents[i]) * 180 / π
    maxAngle = getMaxAllowedAngle(a, b, i)
    if angleDeg > maxAngle:
      failures.add({ type: 'tangent', edgeVertexIndex: i, delta: angleDeg })

    // Профиль высот
    deltaH = |a.heightProfile[i] − b.heightProfile[i]|
    if deltaH > ε_height (0.001):
      failures.add({ type: 'height', edgeVertexIndex: i, delta: deltaH })

  // Проверка guaranteedDepth
  if a.guaranteedDepth < 1 OR b.guaranteedDepth < 1:
    failures.add({ type: 'guaranteedDepth', severity: 'warning' })

  return {
    passed: failures.length == 0,
    failures,
  }
```

`getMaxAllowedAngle(a, b, i)`: если оба контракта `deterministic` — жёсткий допуск 1°. Если хотя бы один `stochastic` — допуск из `maxAngleDeg` (5°).

### 1.3 Ресемплирование (resample)

```
resample(contract: EdgeContract, targetDepth: number) → EdgeContract
  factor = 2^(contract.depth − targetDepth)

  if factor == 0: return contract  // та же глубина

  if factor > 0:  // Повышение глубины (больше вершин)
    newCount = (resolution + 1) * 2^factor
    for i = 0 to newCount:
      t = i / (newCount - 1)  // [0, 1] вдоль ребра
      newPositions[i] = cubicInterp(contract.vertexPositions, t)
      newHeights[i] = cubicInterp(contract.heightProfile, t)
      newTangents[i] = cubicInterp(contract.tangents, t)

  else:  // Понижение глубины (decimation, factor < 0)
    step = 2^|factor|
    for i = 0 to resolution step step:
      newPositions[i/step] = contract.vertexPositions[i]
      // ... heights, tangents аналогично

  return new EdgeContract с targetDepth
```

**Кубическая интерполяция:** используется Catmull-Rom сплайн по 4 соседним точкам для плавного профиля высот и тангентов. Линейная интерполяция дала бы излом нормалей на стыке двух сегментов.

### 1.4 Межконтрактный стык (createInterface)

```
createInterface(chunkAId, chunkBId, edge) → InterContractEdge
  contractA = storage.get(chunkAId, edge)
  contractB = storage.get(chunkBId, oppositeEdge(edge))

  // Построить resampleMap: сопоставление индексов вершин
  if contractA.depth == contractB.depth:
    resampleMap = identity: i → i
  else if contractA.depth > contractB.depth:
    // A глубже: каждая вторая вершина A → вершина B
    step = 2^(contractA.depth - contractB.depth)
    resampleMap = [0, step, 2*step, ..., resolution]
  else:
    // B глубже: вершины A → каждая вторая B
    resampleMap обратное

  verified = verify(contractA, contractB).passed

  return { edge, chunkA: contractA, chunkB: contractB, resampleMap, verified }
```

### 1.5 Стохастический контракт (verifyStochasticContract)

```
verifyStochasticContract(contracts, sampleSize) → StochasticResult
  // Статистическая проверка M случайных пар стохастических рёбер
  pairs = randomPairs(contracts, sampleSize)
  angles = []

  for each (a, b) in pairs:
    // Вычислить тангенциальное отклонение в каждой общей вершине
    for each sharedVertex in commonVertices(a, b):
      angleDeg = angleBetween(a.tangents[i], b.tangents[i]) * 180 / π
      angles.push(angleDeg)

  meanBias = mean(angles)
  variance = variance(angles)
  maxObserved = max(angles)

  // Критерии прохождения
  passesMean = abs(meanBias) < ε_mean (0.1°)
  passesVariance = variance < ε_variance (0.5°)
  passesMax = maxObserved ≤ maxAngleDeg  // из контракта (5°)
  noSystematicBias = checkBiasByFaceAndDepth(angles, pairs)

  return {
    meanBias, variance, maxObserved,
    passesContract: passesMean AND passesVariance AND passesMax AND noSystematicBias,
    failures: pairs where maxObserved > maxAngleDeg,
  }
```

### 1.6 Отзыв контракта (revoke)

```
revoke(chunkId):
  contracts = storage.get(chunkId)
  for each contract in contracts:
    // Инвалидировать InterContractEdge-ы, ссылающиеся на этот контракт
    for each interface in interfaces.values():
      if interface.chunkA.chunkId == chunkId OR interface.chunkB.chunkId == chunkId:
        interface.verified = false
    storage.delete(chunkId, contract.edge)
```

## 2. Структуры данных

```ts
interface EdgeContract {
  chunkId: string;
  edge: 'left' | 'right' | 'bottom' | 'top';
  face: number;
  depth: number;
  vertexPositions: Vector3[];   // resolution+1 вершин вдоль ребра
  heightProfile: number[];       // нормализованные высоты [0, 1]
  tangents: Vector3[];           // тангенциальные векторы вдоль ребра
  guaranteedDepth: number;       // число вершинных рядов внутрь
  g1Guarantee: 'deterministic' | 'stochastic';
  maxAngleDeg: number;           // допустимый max угол для stochastic
  timeBudgetMs: number;
  memoryBudgetBytes: number;
  seed: number;
  contentType: ContentType;
  patchIds: string[];
}

class BoundaryContractEngine {
  private storage: Map<string, EdgeContract[]>;  // chunkId → 4 контракта
  private interfaces: Map<string, InterContractEdge>;  // "chunkA:edge:chunkB" → interface
}
```

**Memory footprint per contract:** ~200 байт для positions/heights/tangents (3 × 17 × 8 = 408 байт при res=16) + fields (~80 байт) ≈ 500 байт. На чанк: 4 × 500 = 2 KiB контрактов. При 1000 активных чанков: ~2 MiB.

## 3. Производительность

| Операция | Complexity | ~Time |
|----------|-----------|-------|
| `declare` | O(resolution) | ~10 µs (копирование рёбер) |
| `verify` | O(resolution) | ~15 µs (сравнение) |
| `resample` | O(resolution × 2^|Δdepth|) | ~20 µs |
| `createInterface` | O(resolution) | ~5 µs |
| `verifyStochasticContract` | O(sampleSize × resolution) | ~50 ms (1000 пар) |
| `revoke` | O(interfaces) | ~2 µs |

## 4. Интеграция с Babylon.js

Не используется. BoundaryContractEngine — чистые структуры данных и геометрические вычисления.

## 5. Обработка ошибок

| Условие | Поведение |
|---------|-----------|
| Сосед не существует (null-контракт) | Ребро без контракта — генератор свободен, verify не вызывается |
| `|depthA − depthB| > 1` | Запрещено инвариантом QuadtreeManager. Если случилось — ошибка assertion |
| Пустой контракт | `vertexPositions` не может быть пустым (минимум 2 вершины, resolution ≥ 1) |
| `revoke` несуществующего chunkId | No-op |
| Стохастическая проверка на малом sampleSize (< 100) | Warning: результат недостоверен |

## 6. Состояния

Stateless. Хранилище `storage` и `interfaces` — внешнее мутабельное состояние. Сам движок не имеет состояний времени выполнения.

## Ссылки

- Requirement spec: `docs/LOD/04-boundary-contract.md`
- Используется: ChunkGenerator, PolarTopologyHandler, PlanetRoot
