# Спецификация требований — QuadtreeManager

## 1. Назначение

Ведение логического квадродерева на 6 гранях кубической сферы. Выполнение
операций split и merge. Энфорсмент инварианта максимальной разницы глубин
соседних чанков (≤ 1). Не владеет геометрией — только логическая структура.

## 2. Связь с родительской спецификацией

| Требование | Как удовлетворяется |
|------------|--------------------|
| LOD-REQ-GEN2 | Split и merge операции с полным отслеживанием инвариантов: внутренние стыки, внешний периметр, round-trip |
| LOD-REQ-003 | Обход невидимых чанков через traverseOccluded |
| LOD-REQ-GEN | Контрактная проверка depth delta ≤ 1 после каждой операции |

## 3. Функциональные требования

### LOD-QM-001: 6 корней квадродерева
**Приоритет:** high
**Статус:** не реализовано

QuadtreeManager инициализируется с 6 корневыми узлами (faces 0–5), каждый на
depth 0 с координатами (tx=0, ty=0). Все корни в состоянии `virtual`.

### LOD-QM-002: Адресация узла
**Приоритет:** high
**Статус:** не реализовано

Каждый узел однозначно идентифицируется четвёркой `(face, depth, tx, ty)`, где:
- `face ∈ [0, 5]` — грань кубической сферы
- `depth ∈ [0, maxDepth]` — глубина в квадродереве
- `tx ∈ [0, 2^depth - 1]` — X-индекс тайла
- `ty ∈ [0, 2^depth - 1]` — Y-индекс тайла

### LOD-QM-003: Split
**Приоритет:** high
**Статус:** не реализовано

`split(node: QuadNode): QuadNode[]`

Создаёт 4 дочерних узла на depth+1 с координатами:
- (2×tx, 2×ty)
- (2×tx+1, 2×ty)
- (2×tx, 2×ty+1)
- (2×tx+1, 2×ty+1)

Предусловия:
- node.state ∈ {virtual, loaded}
- node.depth < maxDepth

Постусловия:
- node.state = 'split'
- node.children.length = 4
- Все 4 ребёнка в состоянии 'virtual'
- EP1: ContractVerifier.checkSplitSeams выполнен (если есть геометрия)

### LOD-QM-004: Merge
**Приоритет:** high
**Статус:** не реализовано

`merge(children: QuadNode[]): QuadNode`

Уничтожает 4 дочерних узла и переводит родительский узел из 'split' в 'virtual'.

Предусловия:
- children.length = 4
- Все 4 — дети одного родителя
- Ни один ребёнок не в состоянии 'split' (рекурсивный merge запрещён — сначала
  merge внуков)

Постусловия:
- parent.state = 'virtual'
- parent.children = null
- Дочерние узлы более не достижимы

### LOD-QM-005: Соседи
**Приоритет:** high
**Статус:** не реализовано

`getNeighbor(node, edge)` возвращает соседа на том же depth (или ближайшего
существующего). `getNeighborAtDepth(node, edge, targetDepth)` возвращает соседа
на конкретной глубине.

Для cross-face соседей используется PolarTopologyHandler.

Соседние ссылки кэшируются в `node.neighbors` (left, right, bottom, top как
массивы NeighborRef — на одном ребре могут быть несколько соседей если их
глубины различаются).

### LOD-QM-006: Обход дерева
**Приоритет:** high
**Статус:** не реализовано

`traverseVisible(camera, visitor)` — обходит видимые узлы.
`traverseOccluded(camera, visitor)` — обходит невидимые узлы (REQ-003).

Оба обхода depth-first, visitor вызывается для каждого узла, включая split-узлы
(которые делегируют обход детям).

### LOD-QM-007: Max depth delta invariant
**Приоритет:** high
**Статус:** не реализовано

`enforceMaxDepthDelta(node)` — проверяет, что разница глубин любых соседних
узлов ≤ 1. При нарушении — принудительный split менее глубокого соседа.

Вызывается после каждого цикла split/merge. Рекурсивен (ripple): split соседа
может создать новые нарушения, процесс повторяется до стабилизации (но не
более maxDepth итераций).

## 4. Интерфейс

```ts
interface QuadNode {
  face: number;
  depth: number;
  tx: number;
  ty: number;
  state: 'virtual' | 'loaded' | 'split';
  children: QuadNode[] | null;
  neighbors: {
    left: NeighborRef[];
    right: NeighborRef[];
    bottom: NeighborRef[];
    top: NeighborRef[];
  };
}

interface NeighborRef {
  face: number;
  depth: number;
  tx: number;
  ty: number;
  edge: 'left' | 'right' | 'bottom' | 'top';
}

class QuadtreeManager {
  constructor(maxDepth: number);
  getRoots(): QuadNode[];
  split(node: QuadNode): QuadNode[];
  merge(children: QuadNode[]): QuadNode;
  getNeighbor(node: QuadNode, edge: Edge): QuadNode | null;
  getNeighborAtDepth(node: QuadNode, edge: Edge, targetDepth: number): QuadNode | null;
  traverseVisible(camera: Vector3, visitor: (n: QuadNode) => void): void;
  traverseOccluded(camera: Vector3, visitor: (n: QuadNode) => void): void;
  enforceMaxDepthDelta(node: QuadNode): void;
}
```

## 5. Краевые случаи

- **maxDepth = 0:** split всегда отклоняется (уже на пределе)
- **Сосед на другой грани:** разрешается через PolarTopologyHandler; для
  неполярных граней — cross-face mapping рёбер
- **Сосед не существует (край дерева):** возвращается null — генератор
  обрабатывает как «свободное ребро» (без контракта)
- **Все 4 ребёнка на maxDepth:** split невозможен, даже если LODEvaluator
  требует — узел остаётся loaded
- **Ripple-шторм:** принудительные split-ы соседей ограничены maxDepth и не
  могут уйти в бесконечную рекурсию

## 6. Зависимости

PolarTopologyHandler (для cross-face соседей). ContractVerifier (DEBUG-проверки).

## 7. Стратегия тестирования

- **Property-based:** случайные (face, depth, tx, ty) → split → 4 ребёнка имеют
  корректные координаты [2×tx, 2×tx+1] × [2×ty, 2×ty+1]
- **Merge round-trip:** split(node) → merge(children) = node той же структуры
  (за исключением state)
- **Neighbor consistency:** getNeighbor(A, right) = B ⇒ getNeighbor(B, left) = A
- **Depth delta:** после 100 случайных split/merge нет пар соседей с
  |depthA − depthB| > 1
- **Cross-face:** соседство faces 0–2–1–3–4–5 проверяется для всех рёбер
