# Спецификация требований — CacheSubsystem

## 1. Назначение

LRU-кэш сгенерированных чанков. Единственный владелец мешей и геометрии.
Управляет жизненным циклом: insert, access (LRU order), eviction по приоритетам,
dispose. Write-through для deformation-патчей отложен до реализации
DeformationSystem.

## 2. Связь с родительской спецификацией

| Требование | Как удовлетворяется |
|------------|--------------------|
| LOD-REQ-GEN6 | Write-through: отложен до реализации DeformationSystem |
| LOD-REQ-002 | LRU-вытеснение: evict по приоритетам, O(1) lookup + O(n) evict |
| LOD-REQ-003 | Хранение невидимых чанков наряду с видимыми |
| LOD-REQ-GEN | EP9: onEvict-колбэк для cleanup мешей |

## 3. Функциональные требования

### LOD-CS-001: LRU-кэш чанков
**Приоритет:** high
**Статус:** реализовано

`CacheSubsystem(options?)` создаёт LRU-кэш с опциями:
- `maxSize` — максимальное число записей (по умолчанию 1000)
- `onEvict` — колбэк при вытеснении: `(key: string, entry: ChunkCacheEntry) => void`

Ключ — chunkId (`f{face}-d{depth}-{tx}-{ty}`).
Значение — `ChunkCacheEntry`:

```ts
interface ChunkCacheEntry {
  chunkId: string;
  mesh: Mesh | null;
  geometry: ChunkGeometry | null;
  lastAccess: number;
  state: 'ready' | 'generating' | 'evictable';
  generationPromise: Promise<ChunkGeometry> | null;
}
```

Поля `material`, `contracts`, `patches` отложены — зависят от
BoundaryContractEngine и DeformationSystem, которые ещё не реализованы.

### LOD-CS-002: Доступ и учёт использования
**Приоритет:** high
**Статус:** реализовано

- `get(chunkId)` — возвращает entry или undefined, обновляет lastAccess и LRU-порядок
- `has(chunkId)` — проверка наличия без изменения lastAccess и LRU-порядка
- `touch(chunkId)` — обновляет lastAccess и LRU-порядок (для frequently used чанков)

### LOD-CS-003: Вставка и вытеснение
**Приоритет:** high
**Статус:** реализовано

`put(chunkId, entry)` — добавляет запись в кэш. Если кэш полон, вызывает
evict(1) для освобождения места. При перезаписи существующего ключа вызывается
onEvict для старой записи.

`evict(count)` — удаляет `count` записей в порядке приоритета вытеснения:

1. **evictable** — записи, явно помеченные `state: 'evictable'` (PlanetRoot
   выставляет после merge — чанк более не нужен). Вытесняются в LRU-порядке
   среди evictable.
2. **Остальные** (кроме `state: 'generating'`) — LRU-порядок.

Tier 3 «visible vs invisible» отложен — требует знания камеры/фрустума,
которым CacheSubsystem не владеет. Будет добавлен при реализации PlanetRoot.

Для каждой вытесняемой записи вызывается `onEvict(key, entry)`. Caller
(PlanetRoot) отвечает за mesh.dispose(), contract revoke и т.д.

Возвращает список evicted chunkIds.

Флаг `state` управляется внешним кодом:
- `'ready'` — чанк активен и отображается
- `'generating'` — геометрия в процессе генерации (eviction пропускает)
- `'evictable'` — чанк можно вытеснять в первую очередь

### LOD-CS-004: Write-through для deformation
**Приоритет:** medium (будущее)
**Статус:** отложено

Будет реализовано после DeformationSystem. `writePatch` применяет патч к
геометрии чанка в кэше и сохраняет в persistent-слой.

### LOD-CS-005: Дифф-хранение патчей
**Приоритет:** medium (будущее)
**Статус:** отложено

`getPatches` и `getBaseGeometry` будут реализованы после DeformationSystem.

### LOD-CS-006: Полная очистка
**Приоритет:** high
**Статус:** реализовано

`dispose()` вызывает onEvict для каждой записи в кэше, очищает хранилище.
Постусловие: размер кэша = 0. onEvict отвечает за освобождение Babylon.js
ресурсов.

## 4. Интерфейс

```ts
interface ChunkCacheEntry {
  chunkId: string;
  mesh: Mesh | null;
  geometry: ChunkGeometry | null;
  lastAccess: number;
  state: 'ready' | 'generating' | 'evictable';
  generationPromise: Promise<ChunkGeometry> | null;
}

interface CacheSubsystemOptions {
  maxSize?: number;       // default 1000
  onEvict?: (key: string, entry: ChunkCacheEntry) => void;
}

class CacheSubsystem {
  constructor(options?: CacheSubsystemOptions);
  get(chunkId: string): ChunkCacheEntry | undefined;
  has(chunkId: string): boolean;
  touch(chunkId: string): void;
  put(chunkId: string, entry: ChunkCacheEntry): void;
  evict(count: number): string[];
  getSize(): number;
  getMaxSize(): number;
  dispose(): void;
}
```

## 5. Краевые случаи

- **Кэш пуст:** get возвращает undefined, evict(1) не делает ничего
- **maxSize = 0:** кэш всегда пуст, каждый вызов get → undefined, put вызывает
  onEvict и не сохраняет запись
- **Дублирующийся chunkId:** put перезаписывает старую запись (вызывается onEvict
  для старой перед заменой)
- **Генерация в процессе (state = 'generating'):** get возвращает entry с
  generationPromise; потребитель ждёт Promise вместо повторной генерации.
  Eviction пропускает generating-записи.
- **Зацикленное вытеснение:** если requested count > maxSize, вытесняются все
  не-generating записи
- **count = 0:** evict(0) возвращает пустой массив

## 6. Зависимости

Babylon.js (тип Mesh). Зависимости от BoundaryContractEngine и
DeformationSystem — отложены (onEvict-колбэк вместо прямой связи).

## 7. Стратегия тестирования

- **LRU порядок:** вставить 3 записи, прочитать 1-ю → evict(2) вытесняет 2-ю и
  3-ю (не 1-ю — она touched)
- **Вытеснение при переполнении:** maxSize=1, put(A), put(B) → A evicted,
  размер = 1
- **Приоритет evictable:** evictable-записи вытесняются раньше ready
- **generating-skip:** generating-записи не вытесняются
- **dispose:** после dispose getSize() = 0, onEvict вызван для всех
- **maxSize=0:** put не сохраняет, onEvict вызывается
- **onEvict callback:** вызывается при evict, перезаписи put и dispose

## 8. Architectural Decisions

| Решение | Альтернатива | Обоснование |
|---------|-------------|-------------|
| Array-based LRU (string[] + splice) | LinkedHashMap | maxSize=1000 → O(n) ~1 µs, код проще |
| Chunk-specific (не generic) | Generic LRU<K,V> | Методы сфокусированы на чанках; generic не даёт выгоды |
| onEvict колбэк вместо жёсткой связи | Прямой вызов BoundaryContractEngine | Loose coupling — CacheSubsystem не знает о BCE |
| evictable → LRU (2 tiers) | 3 tiers + frustum | Tier 3 (visible/invisible) требует PlanetRoot |
| material/contracts/patches deferred | Все поля сразу | Зависимые компоненты не реализованы; добавим позже |
