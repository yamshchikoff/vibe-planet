# Техническая спецификация — AsyncJobScheduler

## 1. Алгоритмы

### 1.1 Инициализация пула Worker-ов

```ts
class AsyncJobScheduler {
  private workers: Worker[];
  private workerStates: ('idle' | 'busy')[];
  private queue: JobItem[];          // FIFO очередь
  private timeBudgetFn: (depth: number) => number;
  private pendingJobs: Map<string, JobTicket<HeightSampleResponse>>;
  private cancelled: boolean;

  constructor(options: { workerCount: number; timeBudgetFn: (d: number) => number }) {
    this.timeBudgetFn = options.timeBudgetFn;
    this.workers = [];
    this.workerStates = [];
    this.queue = [];
    this.cancelled = false;

    const count = Math.max(options.workerCount, 1);
    for (let i = 0; i < count; i++) {
      this.spawnWorker(i);
    }
  }

  private spawnWorker(index: number): void {
    // Worker загружает HeightSamplerWorkerProxy
    const worker = new Worker(
      new URL('./height-sampler.worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e: MessageEvent<HeightSampleResponse>) => {
      // Результат пришёл — резолвить promise
      const jobId = e.data.jobId;
      const ticket = this.pendingJobs.get(jobId);
      if (ticket) {
        ticket.resolve(e.data);
        this.pendingJobs.delete(jobId);
      }
      this.workerStates[index] = 'idle';
      this.processQueue();  // Взять следующее задание из очереди
    };

    worker.onerror = (err) => {
      // Worker упал — пересоздать, задание в очередь
      console.error(`Worker ${index} crashed:`, err);
      this.workerStates[index] = 'idle';
      this.spawnWorker(index);  // пересоздать
      // Прерванное задание вернуть в очередь
    };

    this.workers[index] = worker;
    this.workerStates[index] = 'idle';
  }
}
```

**Worker создаётся один раз** и живёт до `terminate()`. Мягкая отмена невозможна (Web Workers не поддерживают interrupt), поэтому отмена — hard terminate + recreate.

### 1.2 Диспетчеризация sync/async

```
shouldUseSync(depth, estimatedCostMs) → boolean
  budget = timeBudgetFn(depth)  // бюджет в мс для этой глубины
  return estimatedCostMs < budget
```

**Правило:** если генерация укладывается в бюджет — синхронно (нет накладных расходов на Worker postMessage/transfer). Если превышает — async.

Бюджет `timeBudgetFn(depth)` должен быть откалиброван профилированием:
- depth 0–3: крупные чанки, мало вершин на чанк но их ~0-64 → бюджет 4 ms
- depth 4–7: средние чанки, много вершин → бюджет 2 ms
- depth 8–12: мелкие чанки, площадь мала → бюджет 1 ms

Общий бюджет на кадр: 8 ms из 16.6 ms (остальное — рендеринг, физика, LOD-оценка).

### 1.3 Планирование заданий

```
scheduleHeightSampling(request: HeightSampleRequest) → JobTicket<HeightSampleResponse>
  if this.cancelled:
    return rejectedTicket('Scheduler has been terminated')

  // Если Worker-ы не поддерживаются (или workerCount=0) → sync fallback
  if this.workers.length == 0 OR typeof Worker === 'undefined':
    // Синхронный fallback на главном потоке (R-009)
    result = heightSampler.sampleBatch(request.points)
    return { id: generateId(), promise: Promise.resolve(result), cancel: () => {} }

  // Найти свободный Worker (round-robin)
  for i = 0 to workers.length-1:
    if workerStates[i] == 'idle':
      workerStates[i] = 'busy'
      return dispatchToWorker(i, request)

  // Все заняты — в очередь
  return enqueue(request)

dispatchToWorker(workerIndex, request):
  jobId = generateId()

  // Transfer: ArrayBuffer передаётся без копирования
  worker = workers[workerIndex]
  worker.postMessage(
    { jobId, points: request.points.buffer, seed: request.seed, octaves: request.octaves },
    [request.points.buffer]  // transfer list
  )

  let resolve, reject;
  const promise = new Promise<HeightSampleResponse>((res, rej) => {
    resolve = res; reject = rej;
  });

  const ticket = {
    id: jobId,
    promise,
    cancel: () => {
      // Hard cancel: terminate + recreate worker
      workers[workerIndex].terminate()
      spawnWorker(workerIndex)
      reject(new Error('AbortError: Job cancelled'))
    }
  };

  pendingJobs.set(jobId, { ...ticket, resolve, reject });
  return ticket

enqueue(request):
  jobId = generateId()
  // ... аналогично, но выполняется из processQueue когда Worker освободится
```

### 1.4 Обработка очереди

```
processQueue():
  if queue.length == 0: return
  if this.cancelled: return

  // Найти свободный Worker
  freeIndex = workerStates.findIndex(s => s == 'idle')
  if freeIndex == -1: return  // все заняты

  nextJob = queue.shift()
  dispatchToWorker(freeIndex, nextJob.request)
  // promise для этого job уже создан в enqueue
```

### 1.5 Отмена всех заданий

```
cancelAll():
  this.cancelled = true

  // Отменить все pending promises
  for each [jobId, ticket] in pendingJobs:
    ticket.reject(new Error('AbortError: Scheduler cancelled'))

  // Очистить очередь
  queue = []

  // Terminate все Worker-ы
  for each worker in workers:
    worker.terminate()

  // Пересоздать Worker-ы для следующего цикла
  for i = 0 to workers.length-1:
    spawnWorker(i)

  this.cancelled = false
  pendingJobs.clear()
```

## 2. Структуры данных

```ts
interface JobTicket<T> {
  id: string;
  promise: Promise<T>;
  cancel(): void;
}

interface HeightSampleRequest {
  points: Float32Array;  // [x0,y0,z0, x1,y1,z1, ...]
  seed: number;
  octaves: number;
}

interface HeightSampleResponse {
  jobId: string;
  heights: Float32Array;  // [h0, h1, ...]
}

class AsyncJobScheduler {
  private workers: Worker[];
  private workerStates: ('idle' | 'busy')[];
  private queue: { jobId: string; request: HeightSampleRequest }[];
  private pendingJobs: Map<string, JobTicketInternal>;
  private timeBudgetFn: (depth: number) => number;
  private cancelled: boolean;
  private stats: { pending: number; completed: number; totalTimeMs: number };
}
```

**Memory footprint:** ~5 KiB на пул Worker-ов (Worker — нативный объект браузера, не JS).

## 3. Производительность

| Операция | ~Time |
|----------|-------|
| `shouldUseSync` | < 1 µs |
| `scheduleHeightSampling` (sync) | ~25 ms (FBM на главном потоке) |
| `scheduleHeightSampling` (async dispatch) | ~0.5 ms (postMessage + transfer) |
| `cancelAll` | ~5 ms (terminate + recreate) |
| Worker postMessage + transfer (ArrayBuffer) | ~0.1 ms (zero-copy) |
| Worker FBM-сэмплирование (289 точек) | ~25 ms (то же что sync, но не блокирует main) |

**Transfer vs copy:** `worker.postMessage(data, [data.buffer])` передаёт ArrayBuffer без копирования. Главный поток теряет доступ к buffer — это ожидаемо, результат приходит обратно через другое сообщение.

## 4. Интеграция с Babylon.js

Не используется. AsyncJobScheduler — чистая логика Worker-ов.

## 5. Обработка ошибок

| Условие | Поведение |
|---------|-----------|
| Web Workers не поддерживаются | `shouldUseSync` всегда true. `scheduleHeightSampling` возвращает `JobTicket` с синхронным результатом (R-009) |
| `workerCount = 0` | Эквивалентно отсутствию Worker — всё sync |
| Все Worker-ы заняты | Задание в FIFO очередь, выполняется при освобождении |
| Длина очереди > cacheSize | Не должно случаться (число pending-чанков ≤ cacheSize). Assert в DEBUG |
| Worker crash | Пересоздать Worker; задание вернуть в очередь или reject |
| `terminate()` + новый вызов | После terminate все вызовы rejected с «Scheduler terminated» |
| Transferable buffer уже передан | Buffer недоступен в главном потоке — результат получен через Promise |

## 6. Состояния

```
Scheduler:
  [running] ──cancelAll──→ [cancelled] ──spawnWorkers──→ [running]
      │
      └── terminate ──→ [terminated]

Worker (каждый из пула):
  [idle] ──dispatch──→ [busy] ──result/error──→ [idle]
    │                     │
    └─────────────────────┘
    (terminate + recreate при hard cancel или crash)
```

## Ссылки

- Requirement spec: `docs/LOD/08-async-scheduler.md`
- Используется: ChunkGenerator (dispatch FBM), PlanetRoot (cancelAll при телепортации)
