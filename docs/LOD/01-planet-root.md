# Спецификация требований — PlanetRoot (Facade)

## 1. Назначение

PlanetRoot — фасад системы LOD-чанков, единственная точка входа. Владеет
жизненным циклом всех подсистем и выполняет покадровый цикл: LOD-оценка →
split/merge → генерация → кэширование → подключение мешей к сцене Babylon.js.

## 2. Связь с родительской спецификацией

| Требование | Как удовлетворяется |
|------------|--------------------|
| LOD-REQ-GEN | Контрактное программирование: все методы PlanetRoot проверяют входные параметры (camera определён, scene активна) |
| LOD-REQ-001 | Оркестрирует незаметную подмену чанков через вызов LODEvaluator и координацию split/merge |
| LOD-REQ-002 | Управляет JIT split/merge циклом: сначала split, затем merge, затем генерация pending |
| LOD-REQ-003 | Вызывает как traverseVisible, так и traverseOccluded |
| LOD-REQ-GEN4 | Координирует с AsyncJobScheduler, но не принимает решений sync/async самостоятельно |

## 3. Функциональные требования

### LOD-PR-001: Инициализация
**Приоритет:** high
**Статус:** реализовано

PlanetRoot при конструировании должен создать и инициализировать все подсистемы:
QuadtreeManager (6 корней), LODEvaluator, ChunkGenerator, CacheSubsystem,
BoundaryContractEngine, AsyncJobScheduler, PolarTopologyHandler.

Параметры конфигурации передаются через `PlanetConfig` и включают:
planetRadius, seed, heightAmplitude, maxDepth, chunkResolution, cacheSize,
timeBudgetFn.

### LOD-PR-002: Покадровый цикл update(camera)
**Приоритет:** high
**Статус:** реализовано

Метод `update(camera: Camera)` должен выполняться каждый кадр.
Babylon.js Camera предоставляет позицию, FOV и viewport — параметры,
необходимые для вычисления screen-space размера чанка.

1. Извлечь cameraParams из camera: position, fovRadians (из camera.fov),
   viewportWidthPx/HeightPx (из engine.getRenderWidth/Height),
   nearPlane/farPlane (из camera.minZ/maxZ)
2. Выполнить обход дерева (traverseVisible + traverseOccluded), для каждого узла
   вызвать LODEvaluator.evaluate(node, cameraParams)
3. Отсортировать решения: сначала split-ы, затем merge-и
4. Выполнить split-ы (QuadtreeManager.split)
5. Выполнить merge-и (QuadtreeManager.merge)
6. EnforceMaxDepthDelta (ripple split, BFS)
7. Для каждого pending листа — запросить контракты соседей, вызвать
   ChunkGenerator.generate(), закэшировать, построить меш.
   Оборачивать generate + CacheSubsystem.put в try/catch: при исключении —
   mesh.dispose(), material.dispose() для предотвращения утечки ресурсов
8. Очистить старые меши (после merge), пометить освобождённые записи
   кэша как 'evictable'

Предусловие: camera — валидный Babylon.js Camera с активной сценой.
Постусловие: все видимые листья либо загружены, либо pending.

### LOD-PR-003: getHeightAt(worldPos)
**Приоритет:** medium
**Статус:** реализовано

Должен вернуть высоту поверхности планеты в заданной мировой точке.
Используется FlightModel для коллизии с поверхностью.

Логика: определить face и UV координаты точки, найти соответствующий лист
квадродерева, запросить интерполированную высоту (из закэшированной геометрии
или через HeightSampler напрямую).

### LOD-PR-004: getQuadtreeSnapshot() и dumpContracts()
**Приоритет:** medium
**Статус:** реализовано

Для тестирования и отладки:
- `getQuadtreeSnapshot()` возвращает плоский список всех узлов с их состояниями
- `dumpContracts()` возвращает отчёт о всех активных контрактах и их статусе
  верификации

### LOD-PR-005: dispose()
**Приоритет:** high
**Статус:** реализовано

Должен корректно освободить все ресурсы: кэш, меши, воркеры, материалы.
Постусловие: все подсистемы уничтожены, сцена не содержит мешей чанков.

## 4. Интерфейс

```ts
interface PlanetConfig {
  planetRadius: number;           // default 6371
  seed: number;
  heightAmplitude: number;        // default 8
  maxDepth: number;               // default 12
  chunkResolution: number;        // verts per edge, default 16
  cacheSize: number;              // default 1000
  timeBudgetFn: (depth: number) => number;
}

class PlanetRoot {
  constructor(config: PlanetConfig, scene: Scene);
  update(camera: Camera): void;
  getHeightAt(worldPosition: Vector3): number;

  // Для тестов
  getQuadtreeSnapshot(): QuadtreeSnapshot;
  dumpContracts(): ContractReport[];

  dispose(): void;
}
```

## 5. Краевые случаи

- **Телепортация камеры** (respawn): все pending-задания отменяются через
  AsyncJobScheduler.cancelAll(), LOD переоценивается заново
- **Нулевой радиус планеты:** fallback к 1 (как в текущем architecture.md)
- **maxDepth = 0:** планета из 6 чанков, по одному на грань
- **cacheSize = 0:** каждый кадр генерировать заново (деградация, но не падение)
- **Сцена остановлена:** update не вызывается, состояние сохраняется

## 6. Зависимости

Все 10 подсистем: QuadtreeManager, LODEvaluator, BoundaryContractEngine,
ChunkGenerator, HeightSampler, CacheSubsystem, AsyncJobScheduler,
PolarTopologyHandler, DeformationSystem (будущее), ContractVerifier.

## 7. Стратегия тестирования

- **Юнит-тесты PlanetRoot:** моки всех подсистем, проверка очерёдности вызовов
  в update()
- **Интеграционные тесты:** PlanetRoot + реальные QuadtreeManager +
  LODEvaluator (без Babylon.js, с мок-сценой)
- **Property-based:** случайные camera позиции, maxDepth, seed → update() не падает,
  getQuadtreeSnapshot() возвращает согласованное дерево
- **Round-trip:** split → merge = identical (через мок-генератор)
