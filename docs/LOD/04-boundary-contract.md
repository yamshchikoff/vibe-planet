# Спецификация требований — BoundaryContractEngine

## 1. Назначение

Центральный механизм контрактного программирования чанков. Декларирует, хранит
и верифицирует граничные контракты для каждого ребра чанка. Обеспечивает
межконтрактный интерфейс между чанками разных LOD-глубин.

## 2. Связь с родительской спецификацией

| Требование | Как удовлетворяется |
|------------|--------------------|
| LOD-REQ-GEN3 | Полная реализация граничного контракта: declare, verify, межконтрактный интерфейс, guaranteed depth |
| LOD-REQ-GEN | Контрактное программирование: проверка входных/выходных инвариантов в declare и verify |
| LOD-REQ-GEN3 (стохастический) | verifyStochasticInvariant для фрактальных поверхностей |
| LOD-REQ-GEN3 (негеометрический) | Хранение timeBudget, memoryBudget, seed, contentType, patchIds |

## 3. Функциональные требования

### LOD-BC-001: Декларация контракта
**Приоритет:** high
**Статус:** не реализовано

`declare(chunkId, edge, geometry)` создаёт EdgeContract для ребра чанка.

Из геометрии чанка извлекаются:
- **vertexPositions** — позиции вершин вдоль ребра (chunkResolution + 1 вершин,
  от угла к углу)
- **heightProfile** — нормализованные высоты рельефа в каждой вершине
- **tangents** — тангенциальные векторы вдоль ребра (численное
  дифференцирование позиций + высот)
- **guaranteedDepth** — число вершинных рядов внутрь чанка, согласованных с
  контрактом

Предусловие: geometry прошла I1–I4 через ContractVerifier.
Постусловие: EP5 — самосогласованность контракта (positions, heights, tangents
внутренне непротиворечивы).

### LOD-BC-002: Верификация двух контрактов
**Приоритет:** high
**Статус:** не реализовано

`verify(a, b)` сравнивает два EdgeContract на соответствие:

- **C⁰:** позиции вершин совпадают с точностью ε_position
- **G¹:** тангенциальные векторы согласованы (угол между ними < ε_angle)
- **Консистентность профиля:** высоты совпадают в каждой точке ребра (не только
  в вершинах)
- **Гарантированная глубина:** оба контракта подтверждают согласованность
  внутрь чанка

Возвращает `ContractVerificationResult` со списком нарушений.

Если чанки на разных глубинах — более глубокий контракт ресемплируется к
глубине менее глубокого перед сравнением.

### LOD-BC-003: Межконтрактный интерфейс
**Приоритет:** high
**Статус:** не реализовано

`createInterface(chunkAId, chunkBId, edge)` создаёт InterContractEdge —
структуру, связывающую два контракта на общем ребре.

Если глубины различаются (d и d+1), `resampleMap` сопоставляет индексы вершин
более глубокого чанка индексам менее глубокого. Например, при d и d+1: вершины
0, 2, 4, ... ребёнка (d+1) соответствуют вершинам 0, 1, 2, ... родителя (d).

### LOD-BC-004: Ресемплирование контракта
**Приоритет:** high
**Статус:** не реализовано

`resample(contract, targetDepth)` создаёт копию контракта, адаптированную под
другую LOD-глубину.

- При повышении глубины (d → d+1): промежуточные вершины интерполируются
  (линейно для позиций, кубически для высот если доступны производные)
- При понижении глубины (d → d−1): выбирается каждое второе значение (decimation)

### LOD-BC-005: Гарантированная глубина
**Приоритет:** high
**Статус:** не реализовано

`verifyGuaranteedDepth(chunkId, contract)` проверяет, что геометрия чанка на
расстоянии `guaranteedDepth` вершинных рядов от границы остаётся согласованной
с контрактом. Без этого контракт — чисто поверхностный (только вершины на
стыке).

### LOD-BC-006: Стохастическая верификация
**Приоритет:** medium
**Статус:** не реализовано

`verifyStochasticInvariant(contracts, sampleSize)` выполняет статистическую
проверку M пар контрактов на разных глубинах, гранях и seed-ах:

- Измеряет угол тангенциального отклонения в каждой общей вершине
- Проверяет: mean ≈ 0, variance < порог, нет систематического bias
- Возвращает `{ meanBias, variance, passesInvariant, failures[] }`

### LOD-BC-007: Отзыв контракта
**Приоритет:** high
**Статус:** не реализовано

`revoke(chunkId)` удаляет все 4 контракта чанка из хранилища. Вызывается при
merge и cache eviction.

### LOD-BC-008: Негеометрические атрибуты
**Приоритет:** medium
**Статус:** не реализовано

Контракт хранит негеометрические поля:
- **timeBudgetMs:** бюджет времени генерации (N(d) в мс)
- **memoryBudgetBytes:** бюджет памяти (для расчёта размера кэша)
- **seed:** детерминированный seed для регенерации
- **contentType:** семантический тип местности (каньон, дорога, ...)
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
  timeBudgetMs: number;
  memoryBudgetBytes: number;
  seed: number;
  contentType: ContentType;
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
  declare(chunkId: string, edge: Edge, geometry: ChunkGeometry): EdgeContract;
  verify(a: EdgeContract, b: EdgeContract): ContractVerificationResult;
  createInterface(chunkAId: string, chunkBId: string, edge: Edge): InterContractEdge;
  resample(contract: EdgeContract, targetDepth: number): EdgeContract;
  verifyGuaranteedDepth(chunkId: string, contract: EdgeContract): boolean;
  verifyStochasticInvariant(contracts: EdgeContract[], sampleSize: number): StochasticResult;
  revoke(chunkId: string): void;
}
```

## 5. Краевые случаи

- **Сосед не существует (null-контракт):** ребро без контракта — генератор
  свободен, верификация не требуется
- **Разница глубин > 2:** запрещена инвариантом QuadtreeManager, но если
  случилась — resample работает для любой разницы
- **Пустой контракт:** все поля инициализированы, массив vertexPositions пустым
  быть не может (минимум 2 вершины на ребре)
- **Стохастическая проверка на малом sampleSize:** результат недостоверен —
  выводится warning

## 6. Зависимости

ContractVerifier (для DEBUG-проверок в declare/verify). В остальном — чистые
структуры данных.

## 7. Стратегия тестирования

- **Declare + Verify:** сгенерировать два смежных чанка с общим seed →
  declare контракты → verify возвращает passed
- **Cross-LOD verify:** чанк d и сосед d+1 → resample → verify passed
- **Умышленное нарушение:** изменить позицию вершины в контракте → verify
  возвращает failed с типом 'position'
- **Стохастический инвариант:** 1000 случайных пар контрактов → meanBias ≈ 0
- **Revoke:** после revoke, попытка verify с отозванным контрактом → ошибка
