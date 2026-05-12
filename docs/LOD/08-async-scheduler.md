# Спецификация требований — AsyncJobScheduler

## 1. Назначение

Управление пулом Web Workers для выгрузки FBM-сэмплирования высот с главного
потока. Принимает решение sync/async на основе временного бюджета N(d).

## 2. Связь с родительской спецификацией

| Требование | Как удовлетворяется |
|------------|--------------------|
| LOD-REQ-GEN4 | Точечная асинхронность: только FBM-сэмплирование, только при превышении бюджета N(d) |
| LOD-REQ-GEN3 | Временной бюджет N(d) из негеометрического контракта |

## 3. Функциональные требования

### LOD-AS-001: Пул Web Workers
**Приоритет:** high
**Статус:** не реализовано

При инициализации создаёт `workerCount` Web Workers (по умолчанию
`navigator.hardwareConcurrency - 1`, минимум 1). Каждый Worker загружает
HeightSamplerWorkerProxy (FBM-сэмплирование).

Worker создаётся один раз и живёт до terminate() — не пересоздаётся на каждый
запрос.

### LOD-AS-002: Принятие решения sync/async
**Приоритет:** high
**Статус:** не реализовано

`shouldUseSync(depth, estimatedCostMs): boolean`

Правило: `estimatedCostMs < timeBudgetFn(depth) → sync`

- Если генерация укладывается в бюджет → синхронно на главном потоке (нет
  накладных расходов на Worker transfer)
- Если превышает → async в Web Worker
- `estimatedCostMs` базируется на профилировании: `chunkResolution^2 ×
  FBM_cost_per_sample`

### LOD-AS-003: Планирование заданий
**Приоритет:** high
**Статус:** не реализовано

`scheduleHeightSampling(request): JobTicket<HeightSampleResponse>`

- Назначает задание свободному Worker-у
- Возвращает `JobTicket` с promise и возможностью отмены
- Если все Worker-ы заняты — задание в очередь (FIFO)
- Передача данных через `ArrayBuffer.transfer()` (не копирование)

### LOD-AS-004: Отмена заданий
**Приоритет:** high
**Статус:** не реализовано

`cancelAll()` отменяет все pending-задания. Вызывается при:
- Телепортации камеры (respawn)
- Сбросе сцены
- dispose()

Каждое задание имеет `AbortSignal`; если задание уже выполняется в Worker-е,
Worker прерывается (через terminate + пересоздание, т.к. Web Workers не
поддерживают мягкую отмену).

### LOD-AS-005: Статистика
**Приоритет:** low
**Статус:** не реализовано

`getStats()` возвращает:
- `pending` — заданий в очереди
- `completed` — всего выполнено
- `avgTimeMs` — среднее время выполнения

Для профилирования и подбора временного бюджета N(d).

## 4. Интерфейс

```ts
interface JobTicket<T> {
  id: string;
  promise: Promise<T>;
  cancel(): void;
}

class AsyncJobScheduler {
  constructor(options: {
    workerCount: number;
    timeBudgetFn: (depth: number) => number;
  });

  scheduleHeightSampling(request: HeightSampleRequest): JobTicket<HeightSampleResponse>;
  shouldUseSync(depth: number, estimatedCostMs: number): boolean;
  cancelAll(): void;
  terminate(): void;
  getStats(): { pending: number; completed: number; avgTimeMs: number };
}
```

## 5. Краевые случаи

- **Web Workers не поддерживаются браузером:** shouldUseSync всегда true.
  Вызов scheduleHeightSampling падает с ошибкой или fallback к sync.
- **workerCount = 0:** эквивалентно отсутствию Worker-ов — всё sync
- **Все Worker-ы заняты:** задание в очереди, выполняется когда Worker
  освободится; максимальная длина очереди = cacheSize (ограничена числом
  pending-чанков)
- **terminate() + новый вызов:** новый вызов после terminate — ошибка
  (ожидается повторная инициализация)
- **Transferable buffer в job завершился:** buffer больше не доступен в
  главном потоке — потребитель уже получил результат через Promise

## 6. Зависимости

HeightSampler (логика FBM внутри Worker). Собственный пул Worker-ов.

## 7. Стратегия тестирования

- **Sync/async порог:** при estimatedCostMs = 10, timeBudgetFn возвращает 100 →
  shouldUseSync = true. При estimatedCostMs = 200 → false
- **Job выполнение:** scheduleHeightSampling → дождаться promise →
  результат совпадает с синхронным sampleBatch
- **Отмена:** schedule → cancelAll → promise rejected with AbortError
- **Worker переиспользование:** 10 заданий на 2 Worker-а → все выполнены,
  Worker-ы не пересоздавались
- **Fallback без Worker:** мок отсутствия Worker → shouldUseSync всегда true,
  scheduleHeightSampling падает с информативной ошибкой
