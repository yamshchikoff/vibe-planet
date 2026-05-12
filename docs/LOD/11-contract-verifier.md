# Спецификация требований — ContractVerifier

## 1. Назначение

Централизованный движок утверждений (assertion engine). Все проверки
инвариантов LOD-системы проходят через этот модуль. В production-сборке —
полный no-op (dead-code elimination через `if (DEBUG)` или `__DEV__`).

## 2. Связь с родительской спецификацией

| Требование | Как удовлетворяется |
|------------|--------------------|
| LOD-REQ-GEN | Все инварианты I1–I10 проверяются здесь. Отключаемость в production |
| LOD-REQ-GEN2 | Split seams, external perimeter, round-trip |
| LOD-REQ-GEN3 | Contract match (C⁰, G¹, профиль высот) |

### Нумерация инвариантов

| # | Метод | Область |
|---|-------|--------|
| I1 | `checkRadialDistance` | Радиальное расстояние вершин |
| I2 | `checkVertexCount` | Число вершин |
| I3 | `checkNormals` | Единичная длина нормалей |
| I4 | `checkFaceOrigin` | Корректность знака на первичной оси грани |
| I5 | `checkSplitSeams` | Внутренние стыки 4 дочерних чанков |
| I6 | `checkExternalPerimeter` | Внешний периметр = контракты соседей |
| I7 | `checkRoundTrip` | Round-trip: split → merge = исходный |
| I8 | `checkContractMatch` | Совпадение двух контрактов (C⁰, G¹, профиль) |
| I9 | `checkLODCoherence` | LOD-когерентность parent ↔ children |
| I10 | `checkCrossFaceContinuity` | Непрерывность чанков на разных гранях |

## 3. Функциональные требования

### LOD-CV-001 (I1): Радиальное расстояние
**Приоритет:** high
**Статус:** не реализовано

`checkRadialDistance(geometry, R, maxH)`

Каждая вершина geometry.positions должна удовлетворять:
`R - ε ≤ |position| ≤ R + maxH + ε`

Проверяется для всех `(resolution + 1)^2` вершин. При нарушении — assertion
error с указанием индекса вершины и отклонения.

### LOD-CV-002 (I2): Число вершин
**Приоритет:** high
**Статус:** не реализовано

`checkVertexCount(geometry, resolution)`

`positions.length / 3 === (resolution + 1)^2`

### LOD-CV-003 (I3): Единичная длина нормалей
**Приоритет:** high
**Статус:** не реализовано

`checkNormals(geometry)`

Для каждой нормали: `|len − 1| < 1e-4`. При нарушении — индексы вершин с
ненормированными нормалями.

### LOD-CV-004 (I4): Face origin
**Приоритет:** high
**Статус:** не реализовано

`checkFaceOrigin(geometry, face)`

Все вершины чанка должны иметь корректный знак на первичной оси грани.
Например, для face+X все x > 0.

### LOD-CV-005 (I5): Внутренние стыки split
**Приоритет:** high
**Статус:** не реализовано

`checkSplitSeams(children, tolerance)`

4 дочерних чанка должны быть непрерывны на всех внутренних стыках:
- Горизонтальный стык: ребро bottom верхних детей = ребро top нижних детей
- Вертикальный стык: ребро right левых детей = ребро left правых детей
- Центральная точка: все 4 ребёнка имеют общую вершину в центре

### LOD-CV-006 (I6): Внешний периметр
**Приоритет:** high
**Статус:** не реализовано

`checkExternalPerimeter(children, neighborContracts, tolerance)`

Внешний периметр группы из 4 дочерних чанков должен совпадать с контрактами
соседей родительского чанка.

### LOD-CV-007 (I7): Round-trip (split → merge)
**Приоритет:** high
**Статус:** не реализовано

`checkRoundTrip(original, reconstructed, tolerance)`

Геометрия, полученная через split → merge, должна совпадать с исходной.
Сравнение по positions и normals с заданным tolerance.

### LOD-CV-008 (I8): Совпадение контрактов
**Приоритет:** high
**Статус:** не реализовано

`checkContractMatch(a, b, tolerance)`

Два контракта на общем ребре должны совпадать:
- Позиции вершин (C⁰)
- Тангенциальные векторы (G¹)
- Профиль высот

Если контракты на разных глубинах — более глубокий ресемплируется перед
сравнением.

### LOD-CV-009 (I9): LOD-когерентность
**Приоритет:** medium
**Статус:** не реализовано

`checkLODCoherence(parentGeom, childGeoms, tolerance)`

Вершины родительского чанка (depth d) должны совпадать с вершинами дочерних
чанков (depth d+1) в позициях, где они перекрываются. Каждая вторая вершина
ребёнка на ребре совпадает с вершиной родителя (при factor 2 разницы глубин).

### LOD-CV-010 (I10): Cross-face непрерывность
**Приоритет:** medium
**Статус:** не реализовано

`checkCrossFaceContinuity(geomA, geomB, sharedEdge, tolerance)`

Два чанка на разных гранях кубической сферы, имеющие общее ребро, должны
иметь совпадающие позиции вершин вдоль этого ребра.

### LOD-CV-011: Отключаемость в production
**Приоритет:** high
**Статус:** не реализовано

Все методы ContractVerifier обёрнуты в `if (DEBUG)` на уровне сайта вызова.
Это позволяет tree-shaker-у полностью удалить проверки из production-бандла.

Сам класс ContractVerifier всегда доступен для импорта (сигнатуры не меняются),
но тело каждой функции — no-op при `DEBUG = false`.

## 4. Интерфейс

```ts
const DEBUG = true; // compile-time toggle, false in production

class ContractVerifier {
  static checkRadialDistance(geometry: ChunkGeometry, R: number, maxH: number): void;
  static checkVertexCount(geometry: ChunkGeometry, resolution: number): void;
  static checkNormals(geometry: ChunkGeometry): void;
  static checkFaceOrigin(geometry: ChunkGeometry, face: number): void;
  static checkSplitSeams(children: ChunkGeometry[], tolerance: number): void;
  static checkExternalPerimeter(
    children: ChunkGeometry[],
    neighborContracts: EdgeContract[],
    tolerance: number
  ): void;
  static checkRoundTrip(
    original: ChunkGeometry,
    reconstructed: ChunkGeometry,
    tolerance: number
  ): void;
  static checkContractMatch(a: EdgeContract, b: EdgeContract, tolerance: number): void;
  static checkLODCoherence(
    parentGeom: ChunkGeometry,
    childGeoms: ChunkGeometry[],
    tolerance: number
  ): void;
  static checkCrossFaceContinuity(
    geomA: ChunkGeometry,
    geomB: ChunkGeometry,
    sharedEdge: SharedEdge,
    tolerance: number
  ): void;
}
```

## 5. Краевые случаи

- **Проверка без геометрии (node.state = 'virtual'):** проверки геометрии
  пропускаются
- **Пустая геометрия** (vertexCount = 0): I2 упадёт, остальные проверки не
  вызываются
- **tolerance = 0:** exact comparison — только для property-based тестов с
  фиксированным seed
- **DEBUG = false:** все вызовы ContractVerifier.check*() — no-op, дерево
  вызовов удаляется бандлером
- **Частичный контракт:** некоторые проверки применимы только к чанкам
  определённых типов — передаётся флаг или проверка сама определяет
  применимость

## 6. Зависимости

Нет. Вызывается ВСЕМИ компонентами. Не имеет обратных зависимостей.

## 7. Стратегия тестирования

- **Каждый инвариант отдельно:** позитивный тест (корректная геометрия → passed)
  и негативный тест (нарушение → assertion error)
- **I1:** сгенерировать чанк → все вершины в [R, R + heightAmplitude].
  Искусственно вытолкнуть одну вершину → assertion
- **I3:** сгенерировать чанк → все нормали единичные. Искусственно обнулить
  нормаль → assertion
- **GEN2:** split родителя → проверить внутренние стыки → merge → проверить
  round-trip
- **GEN3:** declare контракты двух соседей → checkContractMatch → passed.
  Изменить позицию в одном контракте → assertion
- **Production build:** при DEBUG=false, 1000 вызовов checkRadialDistance
  не создают нагрузки (профилирование CPU)
