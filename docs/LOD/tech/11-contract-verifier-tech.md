# Техническая спецификация — ContractVerifier

## 1. Алгоритмы

Все методы статические, pure functions. Вызываются через `if (DEBUG) { ContractVerifier.check*(...) }`.
В production (`DEBUG = false`) тело каждой функции — no-op (dead-code elimination через tree-shaker).

Допуски (tolerance):

| Константа | Значение | Применение |
|-----------|----------|------------|
| `EPS_POSITION` | 0.001 (1 мм) | C⁰ проверки позиций |
| `EPS_NORMAL` | 1e-4 | единичная длина нормалей |
| `EPS_ANGLE_DEG` | 1.0 (1°) | G¹ deterministic |
| `EPS_HEIGHT` | 0.001 | профиль высот |

### I1: Радиальное расстояние

```
checkRadialDistance(geometry, R, maxH):
  for i = 0 to vertexCount-1:
    pos = geometry.positions[i*3 .. i*3+2]
    dist = |pos|
    if dist < R - ε or dist > R + maxH + ε:
      throw Error('I1: vertex i radial distance dist, expected [R-ε, R+maxH+ε]')
```

### I2: Число вершин

```
checkVertexCount(geometry, resolution):
  expected = (resolution + 1)²
  actual = geometry.positions.length / 3
  if actual != expected:
    throw Error('I2: vertex count actual, expected expected')
```

### I3: Единичная длина нормалей

```
checkNormals(geometry):
  for i = 0 to vertexCount-1:
    n = geometry.normals[i*3 .. i*3+2]
    len = |n|
    if abs(len - 1.0) > EPS_NORMAL:
      throw Error('I3: normal i length len')
```

### I4: Face origin

```
checkFaceOrigin(geometry, face):
  axis = face <= 1 ? 0 : (face <= 3 ? 1 : 2)
  sign = face % 2 === 0 ? 1 : -1

  for i = 0 to vertexCount-1:
    pos = geometry.positions[i*3 .. i*3+2]
    val = pos[axis]
    if (sign == 1 && val <= 0) || (sign == -1 && val >= 0):
      throw Error('I4: vertex i on wrong side of face axis axis, sign=sign expected')
```

### I5: Внутренние стыки split (checkSplitSeams)

```
checkSplitSeams(children: ChunkGeometry[4], tolerance):
  // 4 ребёнка: [tl, tr, bl, br] (top-left, top-right, bottom-left, bottom-right)
  // Внутренние стыки:
  //   Горизонтальный: bottom edge tl/tr == top edge bl/br
  //   Вертикальный:   right edge tl/bl == left edge tr/br
  //   Центральная точка: все 4 имеют общую вершину в центре

  RES = sqrt(children[0].positions.length / 3) - 1

  // Горизонтальный стык: bottom tl (idx 0) vs top bl (idx 2)
  for i = 0 to RES:
    posTop = extractEdge(children[0], 'bottom', N)[i]
    posBottom = extractEdge(children[2], 'top', N)[i]
    if |posTop - posBottom| > tolerance:
      throw Error('I5: horizontal seam tl/bl at i, delta ...')

  // Аналогично: bottom tr (idx 1) vs top br (idx 3)
  // Вертикальный стык: right tl (idx 0) vs left tr (idx 1)
  // Центральная точка: br tl == bl tr == tr bl == tl br
```

### I6: Внешний периметр (checkExternalPerimeter)

```
checkExternalPerimeter(children, neighborContracts, eps):
  // Собрать внешний периметр 4 детей (4 ребра родителя)
  // left edge: left tl + left bl, right edge: right tr + right br
  // top edge: top tl + top tr, bottom edge: bottom bl + bottom br

  for each edge in [left, right, bottom, top]:
    assembled = assembleParentEdge(children, edge, N)
    neighbor = neighborContracts[edge]
    if neighbor is null: continue

    for i = 0 to assembled.length-1:
      if |assembled[i] - neighbor.vertexPositions[i]| > eps:
        throw Error('I6: external perimeter mismatch on edge at i')
```

### I7: Round-trip (checkRoundTrip)

```
checkRoundTrip(original, reconstructed, eps):
  if original.positions.length != reconstructed.positions.length:
    throw Error('I7: vertex count mismatch')

  for i = 0 to positions.length-1:
    delta = abs(original.positions[i] - reconstructed.positions[i])
    if delta > eps:
      throw Error('I7: position mismatch at i, delta delta')

  for i = 0 to normals.length-1:
    delta = abs(original.normals[i] - reconstructed.normals[i])
    if delta > eps:
      throw Error('I7: normal mismatch at i, delta delta')
```

### I8: Совпадение контрактов (checkContractMatch)

```
checkContractMatch(a: EdgeContract, b: EdgeContract, eps):
  if a.depth != b.depth:
    deeper = a.depth > b.depth ? a : b
    shallower = a.depth > b.depth ? b : a
    // Resample deeper to shallower depth
    factor = 2 ** |deeper.depth - shallower.depth|
    for i = 0 to shallower.vertexPositions.length:
      j = i * factor  // corresponding vertex in deeper
      // C⁰ check
      if |deeper.vertexPositions[j] - shallower.vertexPositions[i]| > eps:
        throw Error('I8: C⁰ at i')

  else:
    for i = 0 to resolution:
      // C⁰
      if |a.vertexPositions[i] - b.vertexPositions[i]| > eps:
        throw Error('I8: C⁰ at i')
      // Height
      if |a.heightProfile[i] - b.heightProfile[i]| > eps:
        throw Error('I8: height at i')
      // G¹
      angleDeg = angleBetween(a.tangents[i], b.tangents[i]) * 180 / π
      if angleDeg > EPS_ANGLE_DEG:
        throw Error('I8: G¹ at i, angle angleDeg > EPS_ANGLE_DEG')
```

### I9: LOD-когерентность (checkLODCoherence)

```
checkLODCoherence(parentGeom, childGeoms, tolerance):
  // Вершины parent (depth d) должны совпадать с вершинами children (depth d+1)
  // Каждая вторая вершина ребёнка = вершина родителя (factor 2)

  RES_p = sqrt(parentGeom.positions.length / 3) - 1
  N_p = RES_p + 1

  for row = 0 to RES_p:
    for col = 0 to RES_p:
      parentIdx = row * N_p + col
      px = parentGeom.positions[parentIdx*3 .. parentIdx*3+2]

      // Determine child (2×2 subgrid)
      childCol = col >= RES_p/2 ? 1 : 0     // simplified — actual depends on depth ratio
      childRow = row >= RES_p/2 ? 1 : 0

      // Vertex index within child (every 2nd vertex)
      // ...

      if |childVertex - parentVertex| > tolerance:
        throw Error('I9: LOD incoherence at (row,col)')
```

### I10: Cross-face непрерывность (checkCrossFaceContinuity)

```
checkCrossFaceContinuity(geomA, geomB, sharedEdge: SharedEdge, tolerance):
  edgeA = extractEdgeVertices(geomA, sharedEdge.edgeA, N)
  edgeB = extractEdgeVertices(geomB, sharedEdge.edgeB, N)

  if sharedEdge.orientationA == 'reversed':
    edgeA = reverse(edgeA)
  if sharedEdge.orientationB == 'reversed':
    edgeB = reverse(edgeB)

  for i = 0 to min(edgeA.length, edgeB.length)-1:
    if |edgeA[i] - edgeB[i]| > tolerance:
      throw Error('I10: cross-face discontinuity at faceA-faceB edge index i')
```

## 2. Структуры данных

```ts
const DEBUG = true;  // false в production-сборке (dead-code elimination)

const EPS_POSITION = 0.001;   // 1 мм для C⁰
const EPS_NORMAL   = 1e-4;    // для единичных нормалей
const EPS_ANGLE_DEG = 1.0;    // 1° для deterministic G¹
const EPS_HEIGHT   = 0.001;   // 0.1% нормализованной высоты

export interface SharedEdge {
  /** Which edge on geometry A. */
  edgeA: 'left' | 'right' | 'bottom' | 'top';
  /** Which edge on geometry B. */
  edgeB: 'left' | 'right' | 'bottom' | 'top';
  /** Orientation of A's edge vertices — reversed if face adjacency requires it. */
  orientationA: 'direct' | 'reversed';
  /** Orientation of B's edge vertices — reversed if face adjacency requires it. */
  orientationB: 'direct' | 'reversed';
}

export class ContractVerifier {
  static checkRadialDistance(geometry: ChunkGeometry, R: number, maxH: number): void;
  static checkVertexCount(geometry: ChunkGeometry, resolution: number): void;
  static checkNormals(geometry: ChunkGeometry): void;
  static checkFaceOrigin(geometry: ChunkGeometry, face: number): void;

  static checkSplitSeams(children: ChunkGeometry[], tolerance: number): void;
  static checkExternalPerimeter(
    children: ChunkGeometry[],
    neighborContracts: Map<string, EdgeContract>,
    eps: number,
  ): void;
  static checkRoundTrip(
    original: ChunkGeometry,
    reconstructed: ChunkGeometry,
    eps: number,
  ): void;
  static checkContractMatch(a: EdgeContract, b: EdgeContract, eps: number): void;
  static checkLODCoherence(
    parentGeom: ChunkGeometry,
    childGeoms: ChunkGeometry[],
    tolerance: number,
  ): void;
  static checkCrossFaceContinuity(
    geomA: ChunkGeometry,
    geomB: ChunkGeometry,
    sharedEdge: SharedEdge,
    tolerance: number,
  ): void;
}
```

## 3. Зависимости

- `import type { ChunkGeometry } from '../planet/ChunkGenerator'` — только тип
- `import type { EdgeContract } from '../planet/BoundaryContractEngine'` — только тип
- Никаких runtime-зависимостей (ни Babylon.js, ни другие компоненты)

## 4. Производительность

| Проверка | Complexity | ~Time (RES=16) |
|----------|-----------|-----------------|
| I1 | O(N²) | ~10 µs |
| I2 | O(1) | < 1 µs |
| I3 | O(N²) | ~10 µs |
| I4 | O(N²) | ~5 µs |
| I5 | O(N) | ~15 µs |
| I6 | O(N) | ~20 µs |
| I7 | O(N²) | ~20 µs |
| I8 | O(N) | ~10 µs |
| I9 | O(N²) | ~30 µs |
| I10 | O(N) | ~10 µs |
| **Total all checks** | | **~130 µs** |

В production (`DEBUG = false`) — ровно 0 µs.

## 5. Интеграция с Babylon.js

Не используется.

## 6. Обработка ошибок

| Условие | Поведение |
|---------|-----------|
| Проверка без геометрии (node.state = 'virtual') | Пропускается — не вызывается |
| Пустая геометрия (vertexCount = 0) | I2 упадёт, остальные выбрасывают ошибку |
| `tolerance = 0` | Exact comparison — для property-based тестов с фиксированным seed |
| `DEBUG = false` | Все вызовы — no-op, удаляются бандлером |
| Нет neighbourContract для ребра (I6) | Ребро пропускается (свободное ребро) |

## 7. Состояния

Stateless. Все методы static, pure functions.

## Ссылки

- Requirement spec: `docs/LOD/11-contract-verifier.md`
- Вызывается: ВСЕМИ компонентами в DEBUG-режиме
- Предшественник: `BoundaryContractEngine.verify()` — перекрывается I8 (но ContractVerifier независим)
