# Техническая спецификация — ContractVerifier

## 1. Алгоритмы

Все методы статические, вызываются через `if (DEBUG) { ContractVerifier.check*(...) }`.
В production (DEBUG=false) тело каждой функции — `{}` (dead-code elimination).

### I1: Радиальное расстояние

```
checkRadialDistance(geometry, R, maxH):
  for i = 0 to vertexCount-1:
    pos = geometry.positions[i*3 .. i*3+2]
    dist = |pos|
    if dist < R - ε or dist > R + maxH + ε:
      throw AssertionError(`I1: vertex ${i} radial distance ${dist}, expected [${R-ε}, ${R+maxH+ε}]`)
```

**ε = 0.01** (1 см при масштабе планеты — допустимая погрешность floating-point).

### I2: Число вершин

```
checkVertexCount(geometry, resolution):
  expected = (resolution + 1)²
  actual = geometry.positions.length / 3
  if actual != expected:
    throw AssertionError(`I2: vertex count ${actual}, expected ${expected}`)
```

### I3: Единичная длина нормалей

```
checkNormals(geometry):
  for i = 0 to vertexCount-1:
    n = geometry.normals[i*3 .. i*3+2]
    len = |n|
    if abs(len - 1.0) > 1e-4:
      throw AssertionError(`I3: normal ${i} length ${len}`)
```

### I4: Face origin

```
checkFaceOrigin(geometry, face):
  axis = faceToAxis(face)   // 0=x, 1=y, 2=z
  sign = faceToSign(face)   // +1 or -1

  for i = 0 to vertexCount-1:
    pos = geometry.positions[i*3 .. i*3+2]
    if sign * pos[axis] <= 0:
      throw AssertionError(`I4: vertex ${i} on wrong side of face axis ${axis}`)
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

  // Горизонтальный стык
  for i = 0 to RES:
    posTop = children[0].getEdgeVertex('bottom', i)
    posBottom = children[2].getEdgeVertex('top', i)
    if |posTop - posBottom| > tolerance:
      throw AssertionError(`I5: horizontal seam at ${i}, delta ${|posTop-posBottom|}`)
    // Аналогично для children[1] (tr) и children[3] (br)

  // Вертикальный стык
  for i = 0 to RES:
    posLeft = children[0].getEdgeVertex('right', i)
    posRight = children[1].getEdgeVertex('left', i)
    if |posLeft - posRight| > tolerance:
      throw AssertionError(`I5: vertical seam at ${i}`)

  // Центральная точка
  centerTL = children[0].getCornerVertex('br')
  centerTR = children[1].getCornerVertex('bl')
  centerBL = children[2].getCornerVertex('tr')
  centerBR = children[3].getCornerVertex('tl')
  maxDelta = max(|centerTL - centerTR|, |centerTL - centerBL|, |centerTL - centerBR|, ...)
  if maxDelta > tolerance:
    throw AssertionError(`I5: center point delta ${maxDelta}`)
```

**tolerance = 0.001** (1 мм).

### I6: Внешний периметр (checkExternalPerimeter)

```
checkExternalPerimeter(children, neighborContracts, tolerance):
  // Внешний периметр 4 детей должен совпадать с контрактами соседей родителя
  // Контракты соседей родителя = neighborContracts (4 контракта)
  // Периметр детей: left edges [tl, bl], right edges [tr, br], etc.

  parentContracts = assembleParentPerimeter(children)
  // parentContracts — 4 ребра, собранных из периметра детей

  for each edge in [left, right, bottom, top]:
    neighbor = neighborContracts[edge]
    if neighbor is null: continue
    // Ресемплировать parentContract к глубине соседа
    parentContract = parentContracts[edge]
    if parentContract.depth != neighbor.depth:
      parentContract = boundaryEngine.resample(parentContract, neighbor.depth)
    result = boundaryEngine.verify(parentContract, neighbor)
    if not result.passed:
      throw AssertionError(`I6: external perimeter mismatch on ${edge}`)
```

### I7: Round-trip (checkRoundTrip)

```
checkRoundTrip(original, reconstructed, tolerance):
  if original.positions.length != reconstructed.positions.length:
    throw AssertionError('I7: vertex count mismatch')

  for i = 0 to positions.length-1:
    delta = abs(original.positions[i] - reconstructed.positions[i])
    if delta > tolerance:
      throw AssertionError(`I7: position mismatch at ${i}, delta ${delta}`)

  for i = 0 to normals.length-1:
    delta = abs(original.normals[i] - reconstructed.normals[i])
    if delta > tolerance:
      throw AssertionError(`I7: normal mismatch at ${i}, delta ${delta}`)
```

**tolerance = 0** для property-based тестов с фиксированным seed (детерминизм должен быть побитовым).

### I8: Совпадение контрактов (checkContractMatch)

```
checkContractMatch(a: EdgeContract, b: EdgeContract, tolerance):
  if a.depth != b.depth:
    deeper = a.depth > b.depth ? a : b
    shallower = a.depth > b.depth ? b : a
    deeper = boundaryEngine.resample(deeper, shallower.depth)
    return checkContractMatch(shallower, deeper, tolerance)

  for i = 0 to resolution:
    // C⁰
    if |a.vertexPositions[i] - b.vertexPositions[i]| > tolerance:
      throw AssertionError(`I8: C⁰ at ${i}`)
    // G¹
    angleDeg = angleBetween(a.tangents[i], b.tangents[i]) * 180 / π
    maxAngle = a.g1Guarantee == 'stochastic' ? a.maxAngleDeg : 1.0
    if angleDeg > maxAngle:
      throw AssertionError(`I8: G¹ at ${i}, angle ${angleDeg} > ${maxAngle}`)
    // Профиль
    if abs(a.heightProfile[i] - b.heightProfile[i]) > tolerance:
      throw AssertionError(`I8: height profile at ${i}`)
```

### I9: LOD-когерентность (checkLODCoherence)

```
checkLODCoherence(parentGeom, childGeoms, tolerance):
  // Вершины parent (depth d) должны совпадать с вершинами children (depth d+1)
  // Каждая вторая вершина ребёнка на ребре = вершина родителя (factor 2)
  RES_parent = sqrt(parentGeom.positions.length / 3) - 1
  RES_child = sqrt(childGeoms[0].positions.length / 3) - 1

  // Сравнить каждую вторую вершину детей с соответствующей вершиной родителя
  for row = 0 to RES_parent:
    for col = 0 to RES_parent:
      parentIdx = row * (RES_parent + 1) + col

      // Определить, в каком ребёнке эта вершина
      childIdx = ...
      childGeom = childGeoms[childIdx]
      childVertex = childGeom.positions[childIdx * 3 .. childIdx * 3 + 2]
      parentVertex = parentGeom.positions[parentIdx * 3 .. parentIdx * 3 + 2]

      if |childVertex - parentVertex| > tolerance:
        throw AssertionError(`I9: LOD incoherence at (${row},${col})`)
```

### I10: Cross-face непрерывность (checkCrossFaceContinuity)

```
checkCrossFaceContinuity(geomA, geomB, sharedEdge, tolerance):
  // Два чанка на разных гранях, общее ребро
  // Извлечь позиции рёберных вершин и сравнить
  edgeA = extractEdgeVertices(geomA, sharedEdge.edgeOnA)
  edgeB = extractEdgeVertices(geomB, sharedEdge.edgeOnB)

  // Если ориентация разная (reversed) — обратить порядок
  if sharedEdge.orientation == 'reversed':
    edgeB = reverse(edgeB)

  for i = 0 to edgeA.length-1:
    if |edgeA[i] - edgeB[i]| > tolerance:
      throw AssertionError(`I10: cross-face discontinuity at ${sharedEdge.faceA}-${sharedEdge.faceB}`)
```

## 2. Структуры данных

```ts
const DEBUG = true;  // compile-time toggle, false в production-сборке

// Пороги
const ε_position = 0.001;    // 1 мм
const ε_normal = 1e-4;       // для единичных нормалей
const ε_angle_deg = 1.0;     // 1° для deterministic G¹
const ε_height = 0.001;      // 0.1% нормализованной высоты

class ContractVerifier {
  static checkRadialDistance(geometry, R, maxH): void { if (!DEBUG) return; ... }
  static checkVertexCount(geometry, resolution): void { ... }
  static checkNormals(geometry): void { ... }
  static checkFaceOrigin(geometry, face): void { ... }
  static checkSplitSeams(children, tolerance): void { ... }
  static checkExternalPerimeter(children, contracts, eps): void { ... }
  static checkRoundTrip(original, reconstructed, eps): void { ... }
  static checkContractMatch(a, b, eps): void { ... }
  static checkLODCoherence(parent, children, eps): void { ... }
  static checkCrossFaceContinuity(a, b, edge, eps): void { ... }
}
```

Все методы `static`, принимают необходимые данные параметрами. Не хранят состояние.

## 3. Производительность

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

Все проверки вместе — менее 1% кадра. В production (DEBUG=false) — ровно 0 µs (dead-code elimination).

## 4. Интеграция с Babylon.js

Не используется.

## 5. Обработка ошибок

| Условие | Поведение |
|---------|-----------|
| Проверка без геометрии (node.state = 'virtual') | Пропускается |
| Пустая геометрия (vertexCount = 0) | I2 упадёт, остальные не вызываются |
| `tolerance = 0` | Exact comparison — только для property-based тестов с фиксированным seed |
| `DEBUG = false` | Все вызовы — no-op, удаляются бандлером |
| Частичный контракт | Некоторые проверки применимы частично — передаётся флаг |

## 6. Состояния

Stateless. Все методы static, pure functions.

## Ссылки

- Requirement spec: `docs/LOD/11-contract-verifier.md`
- Вызывается: ВСЕМИ компонентами в DEBUG-режиме
