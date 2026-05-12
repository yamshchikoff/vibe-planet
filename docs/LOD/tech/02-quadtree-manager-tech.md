# Техническая спецификация — QuadtreeManager

## 1. Алгоритмы

### 1.1 Адресация и инициализация

6 корней: по одному на каждую грань кубической сферы (faces 0–5).
Каждый корень: `{ face, depth=0, tx=0, ty=0, state='virtual' }`.

```ts
constructor(maxDepth: number) {
  this.maxDepth = maxDepth;
  this.roots = faces.map(f => new QuadNode(f, 0, 0, 0, 'virtual'));
}
```

### 1.2 Split

```
split(node: QuadNode) → QuadNode[]
  precondition: node.depth < maxDepth
  precondition: node.state ∈ {'virtual', 'loaded'}

  // Создать 4 детей на depth+1
  children = [
    new QuadNode(node.face, node.depth+1, node.tx*2,   node.ty*2,   'virtual'),
    new QuadNode(node.face, node.depth+1, node.tx*2+1, node.ty*2,   'virtual'),
    new QuadNode(node.face, node.depth+1, node.tx*2,   node.ty*2+1, 'virtual'),
    new QuadNode(node.face, node.depth+1, node.tx*2+1, node.ty*2+1, 'virtual'),
  ]

  // Обновить ссылки на соседей
  for each child in children:
    for each edge in [left, right, bottom, top]:
      child.neighbors[edge] = computeChildNeighbors(node, child, edge)

  node.children = children
  node.state = 'split'

  return children
```

**Координаты детей:** умножение tx,ty на 2 — стандартная нумерация квадродерева:
- (2×tx, 2×ty) — левый-нижний
- (2×tx+1, 2×ty) — правый-нижний
- (2×tx, 2×ty+1) — левый-верхний
- (2×tx+1, 2×ty+1) — правый-верхний

### 1.3 Merge

```
merge(children: QuadNode[]) → QuadNode
  precondition: children.length == 4
  precondition: все 4 — дети одного родителя (same face, depth-1, parent tx/ty)
  precondition: ни один ребёнок не в 'split'

  parent = children[0].parent
  parent.children = null
  parent.state = 'virtual'

  // Инвалидировать соседские ссылки, указывавшие на детей
  for each child in children:
    for each neighborRef in child.neighbors:
      neighborNode = resolveNode(neighborRef)
      removeFromNeighbors(neighborNode, child)

  return parent
```

### 1.4 getNeighbor / getNeighborAtDepth

```
getNeighbor(node, edge) → QuadNode | null
  // Поиск соседа на том же depth через родительские узлы
  // Алгоритм: подъём до общего предка → спуск к соседу
  // Стандартный quadtree neighbor finding

  if node is root:
    // Сосед на другой грани — через PolarTopologyHandler
    return polarHandler.resolvePolarNeighbor(node, edge, node.depth)

  // Найти соседа через родителя
  parentNeighbor = getNeighbor(node.parent, edge)
  if parentNeighbor is null: return null
  if parentNeighbor.state == 'virtual' or 'loaded': return parentNeighbor

  // parentNeighbor.state == 'split' → спуститься к нужному ребёнку
  childIndex = mapEdgeToChildIndex(edge, node.positionInParent)
  return parentNeighbor.children[childIndex]

getNeighborAtDepth(node, edge, targetDepth) → QuadNode | null
  neighbor = getNeighbor(node, edge)
  if neighbor is null: return null
  // Рекурсивный split соседа до targetDepth если он менее глубокий
  while neighbor.depth < targetDepth AND neighbor.state == 'split':
    childIndex = mapEdgeToChildIndex(edge, ...)
    neighbor = neighbor.children[childIndex]
  return neighbor
```

**mapEdgeToChildIndex:** для левого ребра родителя — левые дети (0, 2); для правого — правые (1, 3); для нижнего — нижние (0, 1); для верхнего — верхние (2, 3).

### 1.5 enforceMaxDepthDelta (BFS ripple)

```
enforceMaxDepthDelta(triggerNode: QuadNode) → void
  queue = new Queue()
  visited = new Set()
  queue.enqueue(triggerNode)
  visited.add(triggerNode.id)

  while queue is not empty AND iterations < maxDepth:
    node = queue.dequeue()

    for each edge in [left, right, bottom, top]:
      neighbors = node.neighbors[edge]
      for each neighborRef in neighbors:
        neighbor = resolveNode(neighborRef)
        if visited.has(neighbor.id): continue

        if abs(node.depth - neighbor.depth) > 1:
          // Принудительный split менее глубокого
          shallower = node.depth < neighbor.depth ? node : neighbor
          deeper = node.depth < neighbor.depth ? neighbor : node

          if shallower.state == 'virtual':
            split(shallower)
            queue.enqueue(shallower)
            visited.add(shallower.id)
          // Если shallower в 'loaded' и |delta| > 1, split поглотит loaded меш
          else if shallower.state == 'loaded':
            split(shallower)
            queue.enqueue(shallower)
            visited.add(shallower.id)

  if iterations >= maxDepth:
    // Ripple не стабилизировался — ошибка конфигурации
    console.warn('Max depth delta enforcement did not converge')
```

**BFS (Breadth-First Search):** все нарушения уровня 1 обрабатываются до уровня 2, и т.д. Это гарантирует завершение за минимальное число итераций — ripple распространяется волнами от источника.

**Ограничения:**
- Не более `maxDepth` итераций (практически 2–3 для умеренного движения камеры)
- Не более `maxDepth` глубина split-а (абсолютный предел)

## 2. Структуры данных

```ts
interface QuadNode {
  face: number;          // 0–5
  depth: number;         // 0–maxDepth
  tx: number;            // 0..2^depth-1, x-индекс в квадродереве
  ty: number;            // 0..2^depth-1, y-индекс в квадродереве
  id: string;            // "f{face}-d{depth}-{tx}-{ty}" (кэшируется)
  state: 'virtual' | 'loaded' | 'split';
  children: QuadNode[] | null;
  parent: QuadNode | null;
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
  edge: 'left' | 'right' | 'bottom' | 'top';  // какое ребро соседа общее
}

class QuadtreeManager {
  private maxDepth: number;
  private roots: QuadNode[];  // 6 корней
  private nodeIndex: Map<string, QuadNode>;  // id → node для быстрого поиска
  private polarHandler: PolarTopologyHandler;
}
```

**Memory footprint:** QuadNode ~200 байт (поля + 4 массива NeighborRef).
При maxDepth=12: общее число узлов ограничено кэшем (~1000 активных чанков), не глубиной (все 6 × 4^12 = 100M узлов никогда не создаются — только те, что в кэше или на пути к ним).

## 3. Производительность

| Операция | Complexity | ~Time |
|----------|-----------|-------|
| `split` | O(1) + O(edges) | ~5 µs |
| `merge` | O(1) + O(edges) | ~3 µs |
| `getNeighbor` | O(depth) | ~2 µs (depth ≤ 12) |
| `getNeighborAtDepth` | O(depth + Δdepth) | ~3 µs |
| `enforceMaxDepthDelta` | O(affected nodes) | ~20 µs (обычно 2–3 ripple) |

## 4. Интеграция с Babylon.js

Не используется. QuadtreeManager — чистая структура данных. Никакие меши, материалы или TransformNode не хранятся в дереве (разделение логического дерева и геометрии — Architecture Decision A).

## 5. Обработка ошибок

| Условие | Поведение |
|---------|-----------|
| `split` при `depth == maxDepth` | Ошибка precondition |
| `split` при `state == 'split'` | Ошибка precondition |
| `merge` не-детей (не 4 siblings) | Ошибка precondition |
| `merge` при `child.state == 'split'` | Ошибка precondition (рекурсивный merge запрещён) |
| Сосед на другой грани | PolarTopologyHandler разрешает cross-face соседство |
| Сосед не существует (край планеты?) | null — куб замкнут, но на стыке граней может не быть соседа нужной глубины |
| Все 4 ребёнка на maxDepth | split невозможен, LODEvaluator должен это учитывать |

## 6. Состояния и переходы

```
  [virtual] ──split──→ [split]
      ↑                   │
      │                   ├── все 4 ребёнка loaded
      │                   │   (геометрия сгенерирована)
      │                   ↓
      │              [split + loaded children]
      │                   │
      ├────merge──────────┘
      │    (дети уничтожены)
      │
      ├── generate ──→ [loaded] ──split──→ [split]
      │                   │                   (меш disposed)
      │                   │
      │                   ├── eviction ──→ [virtual]
      │                   │    (меш disposed)
      │                   │
      └── dispose ────────┬──────────────────┘
                          ↓
                      [disposed]
```

- **virtual**: узел существует, геометрия не генерировалась
- **loaded**: геометрия сгенерирована, меш в сцене, запись в кэше
- **split**: узел имеет 4 детей (которые могут быть virtual, loaded, или split)
- **disposed**: планета уничтожена, все ресурсы освобождены

## Ссылки

- Requirement spec: `docs/LOD/02-quadtree-manager.md`
- Используется: PlanetRoot, PolarTopologyHandler (cross-face соседи)
