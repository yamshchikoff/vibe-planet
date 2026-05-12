# Спецификация требований — LODEvaluator

## 1. Назначение

Вычисление screen-space размера узла квадродерева в пикселях и генерация
булевых сигналов shouldSplit / shouldMerge на основе 1px-порога. Чистая
математика, без зависимостей от других компонентов.

## 2. Связь с родительской спецификацией

| Требование | Как удовлетворяется |
|------------|--------------------|
| LOD-REQ-001 | 1px порог — критерий незаметности подмены |
| LOD-REQ-002 | Экспоненциальные параметры порогов: splitThreshold(d), mergeThreshold(d) |
| LOD-REQ-003 | Видимость чанка: isAboveHorizon для невидимых чанков |

## 3. Функциональные требования

### LOD-LE-001: Оценка размера в пикселях
**Приоритет:** high
**Статус:** не реализовано

`evaluate(node, cameraParams)` вычисляет screen-space размер чанка.

Метод:
1. Вычислить центр чанка в мировых координатах (cube → sphere mapping)
2. Вычислить мировую длину ребра чанка на данном depth: `edgeWorld =
   (π × R) / (2^depth)` (приближение, четверть окружности грани куба)
3. Спроецировать на экран: `screenPx = (edgeWorld / distance) ×
   (viewportHeight / (2 × tan(fovY / 2)))`

Предусловие: cameraParams корректен (fov > 0, viewport > 0).
Постусловие: screenSizePx ≥ 0.

### LOD-LE-002: Пороги split/merge
**Приоритет:** high
**Статус:** не реализовано

Пороги — экспоненциальные функции глубины:

```
splitThreshold(d)  = 1.0 + A * exp(-d / B)
mergeThreshold(d)  = 1.0 - C * exp(-d / D)
```

где A, B, C, D — константы, подобранные так, чтобы:
- На d = 0–3: широкий гистерезис (~1.5 px split, ~0.7 px merge)
- На d = 8–12: жёсткая сходимость к 1.0 (±0.05 px)
- На промежуточных глубинах: плавный переход

Значения по умолчанию: A = 0.5, B = 2.0, C = 0.3, D = 2.0.

### LOD-LE-003: Сигнал shouldSplit
**Приоритет:** high
**Статус:** не реализовано

`shouldSplit = (screenSizePx > splitThreshold(depth)) AND (node.state != 'split')`

REQ-002: split должен быть завершён ДО того, как parent превысит 1 px.
Экспоненциальный порог даёт упреждающий запас на малых глубинах.

### LOD-LE-004: Сигнал shouldMerge
**Приоритет:** high
**Статус:** не реализовано

`shouldMerge = (all 4 children have screenSizePx < mergeThreshold(depth)) AND
(node.state == 'split')`

REQ-002: merge ПОСЛЕ того, как дети стали < 1 px. Все 4 ребёнка должны быть
меньше порога — частичный merge недопустим.

### LOD-LE-005: Горизонтная видимость
**Приоритет:** high
**Статус:** не реализовано

`isAboveHorizon(chunkCenter, cameraPos, planetRadius)` возвращает false, если
чанк скрыт кривизной планеты.

Метод: угол между вектором (cameraPos → chunkCenter) и вектором (cameraPos →
центр планеты). Если chunkCenter находится за горизонтом (ниже касательной к
поверхности планеты из позиции камеры), чанк невидим.

### LOD-LE-006: Фрустум-видимость
**Приоритет:** medium
**Статус:** не реализовано

Дополнительная проверка: bounding sphere чанка против frustum planes.
Чанк за пределами frustum не нуждается в split.

### LOD-LE-007: Массовая оценка
**Приоритет:** medium
**Статус:** не реализовано

`evaluateBatch(nodes, cameraParams)` выполняет оценку для набора узлов.
Оптимизация: cameraParams инвариантен для всех узлов в одном кадре.

## 4. Интерфейс

```ts
interface CameraParams {
  position: Vector3;
  fovRadians: number;
  viewportWidthPx: number;
  viewportHeightPx: number;
  nearPlane: number;
  farPlane: number;
}

interface LODEvaluation {
  screenSizePx: number;
  shouldSplit: boolean;
  shouldMerge: boolean;
  isVisible: boolean;
}

class LODEvaluator {
  constructor(planetRadius: number);
  evaluate(node: QuadNode, camera: CameraParams): LODEvaluation;
  evaluateBatch(nodes: QuadNode[], camera: CameraParams): Map<string, LODEvaluation>;
  getSplitThreshold(depth: number): number;
  getMergeThreshold(depth: number): number;
  isAboveHorizon(chunkCenter: Vector3, cameraPos: Vector3, planetRadius: number): boolean;
}
```

## 5. Краевые случаи

- **Камера внутри чанка** (distance → 0): screenSizePx → ∞, shouldSplit = true
- **Камера очень далеко:** screenSizePx → 0, shouldMerge = true для всех, кроме
  корневых узлов
- **Касательная к горизонту:** чанк на границе горизонта — isAboveHorizon
  возвращает true (запас в сторону видимости)
- **Планета не в кадре:** все чанки невидимы, traverseOccluded всё равно
  работает (REQ-003)
- **d = maxDepth:** shouldSplit всегда false, даже при большом screenSizePx

## 6. Зависимости

Нет. Чистая математика — только planetRadius и cameraParams.

## 7. Стратегия тестирования

- **Детерминированные сценарии:** камера на фиксированном расстоянии от планеты,
  проверка screenSizePx для depth 0, 3, 6, 9, 12
- **Пороговая монотонность:** splitThreshold(d) убывает с ростом d,
  mergeThreshold(d) возрастает
- **Горизонт:** камера на поверхности (altitude = 0) — дальние чанки за
  горизонтом; камера на орбите — горизонт шире
- **Инвариант гистерезиса:** splitThreshold(d) > mergeThreshold(d) для любого d
