# Спецификация требований — ChunkGenerator

## 1. Назначение

Генерация полной геометрии чанка (positions, normals, colors, indices, PBR)
с соблюдением граничных контрактов соседей. Единственный компонент,
производящий геометрию.

## 2. Связь с родительской спецификацией

| Требование | Как удовлетворяется |
|------------|--------------------|
| LOD-REQ-GEN | Пост-генерационные проверки I1–I4 через ContractVerifier |
| LOD-REQ-GEN3 | Contract-first генерация: рёберные вершины из контрактов соседей |
| LOD-REQ-GEN4 | Делегирование FBM-сэмплирования AsyncJobScheduler при превышении бюджета |
| LOD-REQ-GEN5 | Подготовка к слоистой геометрии (интерфейс GenerateRequest допускает слои) |

## 3. Функциональные требования

### LOD-CG-001: Contract-first генерация рёберных вершин
**Приоритет:** high
**Статус:** не реализовано

При генерации чанка C в позиции (face, d, tx, ty):

1. Для каждого из 4 рёбер запросить контракт соседа через
   BoundaryContractEngine
2. Если контракт существует — рёберные вершины C НЕ вычисляются из шума.
   Они сэмплируются напрямую из контракта соседа через
   `BoundaryContractEngine.resample(contract, d)`
3. Если контракт отсутствует (свободное ребро) — вершины вычисляются из
   HeightSampler и составляют новый контракт

Это гарантирует C⁰ непрерывность независимо от разницы LOD-глубин.

### LOD-CG-002: Вычисление позиций
**Приоритет:** high
**Статус:** не реализовано

Для каждой внутренней вершины (u, v) в сетке [0, 1]² чанка:

1. `dir = uvToDir(face, u, v)` — направление от центра планеты
2. `h = HeightSampler.getHeight(dir.x, dir.y, dir.z)` — нормализованная высота
3. `r = planetRadius + h * heightAmplitude` — радиальное расстояние
4. `position = dir * r`

Разрешение: `(chunkResolution + 1) × (chunkResolution + 1)` вершин.

### LOD-CG-003: Вычисление нормалей с учётом рельефа
**Приоритет:** high
**Статус:** не реализовано

Нормаль вычисляется по формуле:

```
N = D - (heightAmp / R) * (∂h/∂u * ∂D/∂u + ∂h/∂v * ∂D/∂v)
```

где D — нормализованный вектор направления из центра планеты, а
производные высоты ∂h/∂u и ∂h/∂v вычисляются центральными разностями.
Коэффициент `heightAmp / R` критически важен (см. B-009).

На границах, где контракт соседа определяет позиции, нормали также
согласуются с контрактом: тангенциальные компоненты из контракта,
нормальный компонент — из численного дифференцирования геометрии чанка.

### LOD-CG-004: Биомное окрашивание
**Приоритет:** high
**Статус:** не реализовано

Цвет вершины определяется нормализованной высотой h ∈ [0, 1] и широтой:
- Низкие высоты → зелёные/коричневые (равнины)
- Средние высоты → серые/каменные (горы)
- Высокие → белые (снег)
- Широтный фактор: полярные регионы холоднее (сдвиг границ биомов)

Границы биомов возмущены domain warp для фрактальных изолиний.

Результат: Float32Array [r, g, b, a] × vertexCount.

### LOD-CG-005: Построение меша Babylon.js
**Приоритет:** high
**Статус:** не реализовано

`buildMesh(geometry, scene, name)` создаёт Mesh из ChunkGeometry:
- `VertexData` с positions, normals, colors, indices
- `PBRMaterial` с roughness, metallic из geometry.pbr
- `mesh.setParent(planetRootTransformNode)` — floating origin через родителя

### LOD-CG-006: Синхронная vs асинхронная генерация
**Приоритет:** medium
**Статус:** не реализовано

`generate(request)` — умная диспетчеризация:
- `AsyncJobScheduler.shouldUseSync(depth, estimatedCost)` → sync или async
- Sync: прямой вызов HeightSampler.sampleBatch
- Async: FBM-сэмплирование в Web Worker, построение буферов на главном потоке

### LOD-CG-007: verifyRoundTrip (статический, для тестирования)
**Приоритет:** medium
**Статус:** не реализовано

Статический метод для проверки round-trip инварианта:
генерирует чанк дважды с одинаковыми параметрами и сравнивает геометрию
побитово/с tolerance.

## 4. Интерфейс

```ts
interface ChunkGeometry {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  pbr: Float32Array;
}

interface GenerateRequest {
  face: number;
  depth: number;
  tx: number;
  ty: number;
  seed: number;
  resolution: number;
  planetRadius: number;
  heightAmplitude: number;
  contracts: {
    left: EdgeContract | null;
    right: EdgeContract | null;
    bottom: EdgeContract | null;
    top: EdgeContract | null;
  };
  patches: DeformationPatch[];
}

class ChunkGenerator {
  constructor(heightSampler: HeightSampler, asyncScheduler: AsyncJobScheduler);
  generateSync(request: GenerateRequest): ChunkGeometry;
  generateAsync(request: GenerateRequest): Promise<ChunkGeometry>;
  generate(request: GenerateRequest): Promise<ChunkGeometry>;
  buildMesh(geometry: ChunkGeometry, scene: Scene, name: string): Mesh;
  static verifyRoundTrip(sampler: HeightSampler, request: GenerateRequest): boolean;
}
```

## 5. Краевые случаи

- **Все 4 контракта отсутствуют:** корневые чанки (depth 0) всегда генерируются
  без контрактов — первичная генерация
- **resolution = 0:** ошибка (минимум 2 вершины на ребро)
- **heightAmplitude = 0:** идеальная сфера, все высоты = 0, нормали = dir
- **planetRadius = 0:** fallback к 1
- **seed меняется между вызовами:** не должен — seed фиксирован в контракте и
  в GenerateRequest
- **Async отменён (камера телепортировалась):** generateAsync должен
  поддерживать AbortSignal

## 6. Зависимости

HeightSampler, BoundaryContractEngine (чтение контрактов), AsyncJobScheduler,
ContractVerifier.

## 7. Стратегия тестирования

- **Contract-first:** сгенерировать соседа A с контрактом → сгенерировать B с
  контрактом A на общем ребре → позиции рёберных вершин B совпадают с позициями
  A (C⁰)
- **Нормали с высотой:** heightAmplitude > 0 → нормали не равны dir (есть наклон
  от рельефа)
- **Round-trip:** два вызова generate с одинаковыми параметрами → идентичная
  геометрия
- **Сравнение sync/async:** generateSync и generateAsync с одинаковыми
  параметрами → идентичный ChunkGeometry
- **Биомная раскраска:** все цвета в [0, 1], нет отрицательных значений
