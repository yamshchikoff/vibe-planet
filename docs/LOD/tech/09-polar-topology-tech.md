# Техническая спецификация — PolarTopologyHandler

## 1. Алгоритмы

### 1.1 Экваториальные грани

```ts
getEquatorialFaces(polarFace: number): number[] {
  // +Y (face 2) и -Y (face 3) граничат с 0, 1, 4, 5
  if (polarFace !== 2 && polarFace !== 3) {
    throw new Error(`Face ${polarFace} is not a polar face`);
  }
  return [0, 1, 4, 5];  // +X, +Z, -X, -Z
}
```

### 1.2 Mapping рёбер

Таблицы предвычислены. Ориентация определяется через cross-product нормалей:

```
orientation = sign(cross(polarNormal, equatorialNormal) · sharedEdgeDirection)
```

Если cross-product полярной нормали и экваториальной нормали сонаправлен с направлением общего ребра — `direct`. Если противонаправлен — `reversed`.

**+Y (face 2, normal = (0, 1, 0)):**

```
getEdgeMapping(face=2, polarEdge):
  switch polarEdge:
    0 (left):   → { equatorialFace: 0 (+X), equatorialEdge: 'top',    orientation: 'direct' }
    1 (right):  → { equatorialFace: 1 (+Z), equatorialEdge: 'top',    orientation: 'direct' }
    2 (bottom): → { equatorialFace: 4 (-X), equatorialEdge: 'top',    orientation: 'reversed' }
    3 (top):    → { equatorialFace: 5 (-Z), equatorialEdge: 'top',    orientation: 'reversed' }
```

**-Y (face 3, normal = (0, -1, 0)):**

```
getEdgeMapping(face=3, polarEdge):
  switch polarEdge:
    0 (left):   → { equatorialFace: 0 (+X), equatorialEdge: 'bottom', orientation: 'reversed' }
    1 (right):  → { equatorialFace: 1 (+Z), equatorialEdge: 'bottom', orientation: 'reversed' }
    2 (bottom): → { equatorialFace: 4 (-X), equatorialEdge: 'bottom', orientation: 'direct' }
    3 (top):    → { equatorialFace: 5 (-Z), equatorialEdge: 'bottom', orientation: 'direct' }
```

**Почему ориентация разная для +Y и -Y:** внешняя нормаль +Y смотрит «вверх» (0,1,0), -Y — «вниз» (0,-1,0). При обходе ребра с постоянным направлением (например, от левого угла к правому) cross-product с нормалью даёт противоположный знак. Следовательно, порядок вершин вдоль общего ребра для +Y и -Y противоположен относительно одной и той же экваториальной грани.

### 1.3 Разрешение полярного соседа

```
resolvePolarNeighbor(polarNode, polarEdge, targetDepth) → NeighborRef | null
  mapping = getEdgeMapping(polarNode.face, polarEdge)

  // Вычислить tx,ty экваториального соседа
  // Полярный чанк (tx, ty) на depth d; ребро polarEdge
  // Экваториальный сосед имеет ту же depth и координаты, проектированные
  // с полярного ребра на экваториальную грань

  // Число тайлов вдоль экваториального ребра = 2^depth
  N = 2^targetDepth

  switch (mapping.orientation):
    'direct':
      // Полярный tx (или ty) прямо отображается на экваториальный
      eqTX = polarNode.tx
      eqTY = polarEdge == 0 OR polarEdge == 1 ? polarNode.ty : N - 1 - polarNode.ty
    'reversed':
      // Обратный порядок: последний полярный тайл → первый экваториальный
      eqTX = N - 1 - polarNode.tx
      eqTY = polarEdge == 0 OR polarEdge == 1 ? N - 1 - polarNode.ty : polarNode.ty

  return {
    face: mapping.equatorialFace,
    depth: targetDepth,
    tx: eqTX,
    ty: eqTY,
    edge: mapping.equatorialEdge,
  }
```

### 1.4 Проверка сходимости в точке полюса

```
verifyPoleConvergence(polarContracts: EdgeContract[], epsilon: number) → {
  converged: boolean; maxDelta: number;
}
  // 4 контракта — по одному на каждое ребро полярного чанка
  // Точка полюса — общая вершина для всех 4 рёбер
  // Это вершина с индексом 0 для left и bottom, и с индексом resolution для right и top
  // (в зависимости от mapping конкретного ребра)

  poleVertices = []
  for each contract in polarContracts:
    mapping = getEdgeMapping(contract.face, contract.edge)
    vertexIndex = mapping.orientation == 'direct' ? 0 : contract.vertexPositions.length - 1
    poleVertices.push(contract.vertexPositions[vertexIndex])

  // Измерить максимальное отклонение между всеми парами
  maxDelta = 0
  for i = 0 to 3:
    for j = i+1 to 3:
      delta = |poleVertices[i] - poleVertices[j]|
      maxDelta = max(maxDelta, delta)

  return { converged: maxDelta < epsilon, maxDelta }
```

### 1.5 Радиальная сетка (опционально, будущее)

```
generateRadialGrid(resolution, faceSign) → PolarGrid
  // faceSign: +1 для +Y, -1 для -Y
  // Генерирует радиально-кольцевую сетку вместо квадратной
  // Радиальные линии от полюса к экватору, кольца параллельно экватору
  //
  // Количество колец = resolution
  // Вершин на кольцо i: 4 * (i + 1)  (адаптивное увеличение к экватору)
  //
  // Сетка гуще у полюса, реже к экватору
  // Внутренняя тесселляция — деталь реализации за контрактом:
  // 4 ребра полярного чанка имеют тот же контракт независимо от тесселляции.
```

## 2. Структуры данных

```ts
interface PolarEdgeMapping {
  polarFace: number;
  polarEdge: Edge;
  equatorialFace: number;
  equatorialEdge: Edge;
  orientation: 'direct' | 'reversed';
}

class PolarTopologyHandler {
  // Предвычисленные таблицы mapping для +Y и -Y
  private mappingByFace: Map<number, Map<Edge, PolarEdgeMapping>>;

  constructor() {
    this.mappingByFace = new Map();
    this.mappingByFace.set(2, buildPlusYMapping());
    this.mappingByFace.set(3, buildMinusYMapping());
  }
}
```

**Memory footprint:** ~200 байт (две таблицы по 4 записи).

## 3. Производительность

Все методы O(1) — table lookup или простая арифметика.

| Операция | ~Time |
|----------|-------|
| `getEquatorialFaces` | < 1 µs |
| `getEdgeMapping` | < 1 µs (Map lookup) |
| `resolvePolarNeighbor` | < 2 µs |
| `verifyPoleConvergence` | < 5 µs (6 сравнений) |
| `generateRadialGrid` | ~50 µs |

## 4. Интеграция с Babylon.js

Не используется.

## 5. Обработка ошибок

| Условие | Поведение |
|---------|-----------|
| Неполярная грань (0, 1, 4, 5) | Ошибка: «Face N is not a polar face» |
| depth = 0 на полюсе | Полярный чанк покрывает всю грань ±Y — 4 ребра расходятся от полюса к экватору как меридианы |
| 4 экваториальных соседа на разной глубине | Контрактный механизм (resample) обрабатывает разницу глубин — PolarTopologyHandler только предоставляет neighbour refs |

## 6. Состояния

Stateless. Таблицы mapping предвычислены в конструкторе и неизменяемы.

## Ссылки

- Requirement spec: `docs/LOD/09-polar-topology.md`
- Используется: QuadtreeManager (cross-face соседи), PlanetRoot (verifyPoleConvergence)
