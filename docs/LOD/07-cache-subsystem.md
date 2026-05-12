# Спецификация требований — CacheSubsystem

## 1. Назначение

LRU-кэш сгенерированных чанков с write-through поддержкой для deformation-
патчей. Единственный владелец мешей и геометрии. Дифф-хранение патчей.

## 2. Связь с родительской спецификацией

| Требование | Как удовлетворяется |
|------------|--------------------|
| LOD-REQ-GEN6 | Write-through: патч одновременно в кэш и persistent-слой. Дифф-хранение |
| LOD-REQ-002 | LRU-вытеснение для JIT split/merge: кэш не должен быть узким горлом |
| LOD-REQ-003 | Хранение невидимых чанков наряду с видимыми |
| LOD-REQ-GEN | EP9: при eviction контракты отозваны, меши disposed |

## 3. Функциональные требования

### LOD-CS-001: LRU-кэш чанков
**Приоритет:** high
**Статус:** не реализовано

`CacheSubsystem(maxSize)` создаёт LRU-кэш заданного размера (по умолчанию 1000).

Ключ — chunkId (`f{face}-d{depth}-{tx}-{ty}`).
Значение — `ChunkCacheEntry`:
- `mesh: Mesh` — Babylon.js меш в сцене
- `geometry: ChunkGeometry` — сырая геометрия (для round-trip и патчей)
- `material: PBRMaterial` — материал меша
- `contracts: EdgeContract[]` — 4 рёберных контракта
- `patches: DeformationPatch[]` — применённые патчи
- `lastAccess: number` — timestamp для LRU
- `state: 'ready' | 'generating' | 'evictable'`
- `generationPromise: Promise<ChunkGeometry> | null`

### LOD-CS-002: Доступ и учёт использования
**Приоритет:** high
**Статус:** не реализовано

- `get(chunkId)` — возвращает entry или undefined, обновляет lastAccess
- `has(chunkId)` — проверка наличия без изменения lastAccess
- `touch(chunkId)` — обновляет lastAccess (для frequently used чанков)

### LOD-CS-003: Вставка и вытеснение
**Приоритет:** high
**Статус:** не реализовано

`put(chunkId, entry)` — добавляет запись в кэш. Если кэш полон, вызывает
`evict(N)` для освобождения места.

`evict(count)` — удаляет `count` наименее недавно использованных записей:
1. Для каждой вытесняемой записи: mesh.dispose(), material.dispose()
2. Вызывает BoundaryContractEngine.revoke(chunkId) для каждого
3. Вызывает DeformationSystem.serializePatches() для сохранения патчей
   (если есть) в persistent-слой
4. Возвращает список evicted chunkIds

### LOD-CS-004: Write-through для deformation
**Приоритет:** medium (будущее)
**Статус:** не реализовано

`writePatch(chunkId, patch)` применяет патч:
1. Находит чанк в кэше
2. Применяет патч к геометрии (через ChunkGenerator.reconstruct)
3. Обновляет меш (новый VertexData)
4. Сохраняет патч в DeformationSystem (persistent-слой)
5. Обновляет `entry.patches` и `entry.contracts`

Патч выживает вытеснение из кэша: persistent-слой хранит дифф.

### LOD-CS-005: Дифф-хранение патчей
**Приоритет:** medium (будущее)
**Статус:** не реализовано

`getPatches(chunkId)` и `getBaseGeometry(chunkId)` предоставляют доступ к
базовой геометрии и патчам раздельно. Патч-слой хранит только дифф (список
`HeightDiff`), а не полную копию геометрии чанка.

### LOD-CS-006: Полная очистка
**Приоритет:** high
**Статус:** не реализовано

`dispose()` освобождает все меши и материалы в кэше, очищает хранилище.
Постусловие: размер кэша = 0, все Babylon.js ресурсы освобождены.

## 4. Интерфейс

```ts
interface ChunkCacheEntry {
  chunkId: string;
  mesh: Mesh;
  geometry: ChunkGeometry;
  material: PBRMaterial;
  contracts: EdgeContract[];
  patches: DeformationPatch[];
  lastAccess: number;
  state: 'ready' | 'generating' | 'evictable';
  generationPromise: Promise<ChunkGeometry> | null;
}

class CacheSubsystem {
  constructor(maxSize: number);
  get(chunkId: string): ChunkCacheEntry | undefined;
  put(chunkId: string, entry: ChunkCacheEntry): void;
  has(chunkId: string): boolean;
  touch(chunkId: string): void;
  writePatch(chunkId: string, patch: DeformationPatch): void;
  evict(count: number): string[];
  getSize(): number;
  getMaxSize(): number;
  getPatches(chunkId: string): DeformationPatch[];
  getBaseGeometry(chunkId: string): ChunkGeometry | undefined;
  dispose(): void;
}
```

## 5. Краевые случаи

- **Кэш пуст:** get возвращает undefined, evict(1) не делает ничего
- **maxSize = 0:** кэш всегда пуст, каждый вызов get → undefined
- **Дублирующийся chunkId:** put перезаписывает старую запись (старый меш
  disposed, старый контракт revoked)
- **Генерация в процессе (state = 'generating'):** get возвращает entry с
  generationPromise; потребитель ждёт Promise вместо повторной генерации
- **Зацикленное вытеснение:** если requested count > maxSize, вытесняются все
- **Вытеснение чанка, на который есть pending ссылка в QuadtreeManager:**
  QuadtreeManager держит QuadNode.state = 'virtual' — не loaded, не ссылается
  на меш

## 6. Зависимости

BoundaryContractEngine (revoke при eviction), DeformationSystem (write-through).
В остальном — чистая структура данных.

## 7. Стратегия тестирования

- **LRU порядок:** вставить 3 записи, прочитать 1-ю → evict(2) вытесняет 2-ю и
  3-ю (не 1-ю — она touched)
- **Вытеснение при переполнении:** maxSize=1, put(A), put(B) → A evicted,
  размер = 1
- **Write-through:** writePatch(id, patch) → patch сохранён в entry.patches и
  в DeformationSystem
- **dispose:** после dispose getSize() = 0, все меши disposed
- **Генерация в процессе:** get возвращает entry с generationPromise;
  put с готовым geometry разрешает Promise
