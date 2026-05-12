# Спецификация требований — HeightSampler

## 1. Назначение

Детерминированное 3D value-noise FBM и ridged multifractal сэмплирование высот
процедурной планеты. Предоставляет синхронный (главный поток) и асинхронный
(Web Worker proxy) интерфейсы.

## 2. Связь с родительской спецификацией

| Требование | Как удовлетворяется |
|------------|--------------------|
| LOD-REQ-GEN | Seed-детерминизм: один seed → идентичные высоты |
| LOD-REQ-GEN4 | Worker proxy для точечной асинхронной выгрузки |
| LOD-REQ-GEN3 (стохастический контракт) | FBM-шум не гарантирует G¹ непрерывности — стохастический контракт |

## 3. Функциональные требования

### LOD-HS-001: Детерминированное 3D value noise
**Приоритет:** high
**Статус:** частично реализовано (текущий HeightSampler.ts)

`getHeight(x, y, z)` возвращает нормализованную высоту [0, 1] для мировой
точки (x, y, z).

Алгоритм:
- 3D value noise с hash-функцией на основе seed
- FBM: 12 октав, lacunarity 2.0, gain 0.5
- Масштаб: scale = 200 (характерный размер особенностей ~200 км)
- Выход: нормализованный [0, 1]

Контракт: для любых (x, y, z) и seed результат детерминирован и ∈ [0, 1].

### LOD-HS-002: Бесшовность
**Приоритет:** high
**Статус:** частично реализовано

3D noise (а не 2D на UV) гарантирует бесшовность: точки на разных гранях
кубической сферы, но физически близкие в пространстве, получают близкие
значения высот.

Непрерывность производных (G¹) НЕ гарантируется — фрактальный шум
принципиально негладок. Для G¹ gaps применяется стохастический контракт
(см. LOD-BC-006).

### LOD-HS-003: Биомный domain warp
**Приоритет:** medium
**Статус:** частично реализовано

`getBiomeWarp(x, y, z, octaves)` возвращает значения [-1, 1] для возмущения
границ биомов. Используется отдельный слой FBM с меньшим числом октав и
меньшим scale для фрактальных изолиний.

### LOD-HS-004: Mountain mask
**Приоритет:** low
**Статус:** не реализовано

`getMountainMask(x, y, z)` возвращает значение [0, 1], контролирующее
вероятность горного рельефа в данной точке. Позволяет создавать континенты
с горными хребтами и равнинами, а не однородный шум по всей планете.

### LOD-HS-005: Пакетное сэмплирование
**Приоритет:** high
**Статус:** не реализовано

`sampleBatch(points: Float32Array): Float32Array` принимает плоский массив
[x1,y1,z1, x2,y2,z2, ...] и возвращает [h1, h2, ...].

Оптимизация для генерации чанка: все вершины сэмплируются одним вызовом.
В синхронном режиме — главный поток. В асинхронном — Web Worker.

### LOD-HS-006: Worker proxy
**Приоритет:** medium
**Статус:** не реализовано

`getWorkerProxy(): HeightSamplerWorkerProxy` возвращает объект для передачи в
AsyncJobScheduler.

Worker принимает `HeightSampleRequest` (points + seed), выполняет FBM на
отдельном потоке, возвращает `HeightSampleResponse` (heights + biomeWarps)
через transferable ArrayBuffer.

## 4. Интерфейс

```ts
interface HeightSampleRequest {
  points: Float32Array;
  seed: number;
}

interface HeightSampleResponse {
  heights: Float32Array;
  biomeWarps: Float32Array;
}

class HeightSampler {
  constructor(seed: number);
  getHeight(x: number, y: number, z: number): number;
  getBiomeWarp(x: number, y: number, z: number, octaves: number): number;
  getMountainMask(x: number, y: number, z: number): number;
  sampleBatch(points: Float32Array): Float32Array;
  getWorkerProxy(): HeightSamplerWorkerProxy;
}

class HeightSamplerWorkerProxy {
  sampleBatchAsync(request: HeightSampleRequest): Promise<HeightSampleResponse>;
}
```

## 5. Краевые случаи

- **seed = 0:** допустим, даёт детерминированную последовательность
- **Очень большие координаты** (десятки тысяч км): hash-функция должна работать
  стабильно без потери точности float32
- **Отрицательные координаты:** hash-функция работает с Math.floor, корректна
  для отрицательных
- **Пустой points (длина 0):** sampleBatch возвращает пустой Float32Array
- **Worker недоступен** (браузер без Web Workers): fallback к синхронному
  сэмплированию на главном потоке

## 6. Зависимости

Нет. Чистая математика — hash-функции и FBM.

## 7. Стратегия тестирования

- **Seed-детерминизм:** два экземпляра HeightSampler с одинаковым seed →
  getHeight(x,y,z) возвращает идентичные значения для 1000 случайных точек
- **Диапазон:** 10000 случайных точек → все высоты ∈ [0, 1]
- **Бесшовность:** две точки на расстоянии ε (близкие в пространстве) →
  разница высот мала (непрерывность C⁰)
- **Воспроизводимость:** замороженный seed даёт побитово идентичный массив
  для одинакового набора точек
- **Worker proxy:** sampleBatchAsync возвращает те же значения, что и
  синхронный sampleBatch
