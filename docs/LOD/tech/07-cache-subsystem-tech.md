# Техническая спецификация — CacheSubsystem

## 1. Алгоритмы

### 1.1 LRU с приоритетным вытеснением

```ts
class CacheSubsystem {
  private map: Map<string, ChunkCacheEntry>;       // O(1) lookup
  private lruList: DoublyLinkedList<string>;        // LRU порядок
  private maxSize: number;
  private boundaryEngine: BoundaryContractEngine;
  private deformationSystem: DeformationSystem;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.map = new Map();
    this.lruList = new DoublyLinkedList();
  }
}
```

**DoublyLinkedList:** двусвязный список chunkId. Голова = наиболее недавно использованный, хвост = наименее недавно использованный.

### 1.2 get / has / touch

```
get(chunkId) → ChunkCacheEntry | undefined
  entry = map.get(chunkId)
  if entry is undefined: return undefined
  // Переместить в голову LRU
  lruList.remove(chunkId)
  lruList.prepend(chunkId)
  entry.lastAccess = performance.now()
  return entry

has(chunkId) → boolean
  return map.has(chunkId)
  // НЕ обновляет LRU (read-only check)

touch(chunkId):
  if map.has(chunkId):
    lruList.remove(chunkId)
    lruList.prepend(chunkId)
```

### 1.3 put (insert + evict)

```
put(chunkId, entry):
  // Если уже существует — перезаписать (старый меш disposed, контракт revoked)
  if map.has(chunkId):
    old = map.get(chunkId)
    old.mesh.dispose()
    old.material.dispose()
    boundaryEngine.revoke(chunkId)
    lruList.remove(chunkId)

  // Освободить место если кэш полон
  while map.size >= maxSize:
    evict(1)

  map.set(chunkId, entry)
  lruList.prepend(chunkId)
  entry.lastAccess = performance.now()
```

### 1.4 evict (приоритетное вытеснение)

```
evict(count: number) → string[]
  evicted = []

  for i = 0 to count-1:
    if map.size == 0: break

    // Построить список кандидатов с приоритетами
    candidates = []
    for each [id, entry] in map:
      priority = getEvictionPriority(entry)
      candidates.push({ id, priority })

    // Сортировать: меньший priority → вытесняется первым
    sort(candidates, by priority ascending)
    victim = candidates[0].id
    entry = map.get(victim)

    // Очистка
    entry.mesh.dispose()
    entry.material.dispose()
    boundaryEngine.revoke(victim)
    if entry.patches.length > 0:
      deformationSystem.serializePatches(victim, entry.patches)

    map.delete(victim)
    lruList.remove(victim)
    evicted.push(victim)

  return evicted

getEvictionPriority(entry) → number
  // Приоритеты:
  //   0 — evictable (помечен после merge)
  //   1 — невидимый, дальний
  //   2 — невидимый, ближний
  //   3 — видимый, LRU
  // Видимый чанк НИКОГДА не вытесняется, если есть кандидаты 0-2

  if entry.state == 'evictable': return 0

  // distanceFromCamera сохранён PlanetRoot при обходе
  if entry.isVisible:
    return 3 + entry.lastAccess  // LRU among visible only
  else:
    return 1 + (1 / (entry.distanceFromCamera + 1))  // дальние первыми
```

**Инвариант:** видимый чанк не вытесняется, если `map` содержит хотя бы одну запись с `isVisible=false` или `state='evictable'`. Assert в DEBUG.

### 1.5 writePatch (write-through)

```
writePatch(chunkId, patch):
  entry = map.get(chunkId)
  if entry is undefined: return  // чанк не в кэше — патч в persistent-слое

  // Применить патч к геометрии
  entry.geometry = chunkGenerator.reconstruct(entry.geometry, patch)
  // Обновить меш
  entry.mesh.updateVerticesData(entry.geometry.positions)
  entry.mesh.updateVerticesData(entry.geometry.normals)
  entry.patches.push(patch)

  // Write-through в persistent-слой
  deformationSystem.writePatch(chunkId, patch)
```

### 1.6 dispose

```
dispose():
  for each [id, entry] in map:
    entry.mesh.dispose()
    entry.material.dispose()
    boundaryEngine.revoke(id)
  map.clear()
  lruList.clear()
```

## 2. Структуры данных

```ts
interface ChunkCacheEntry {
  chunkId: string;
  mesh: Mesh;
  geometry: ChunkGeometry;
  material: PBRMaterial;
  contracts: EdgeContract[];        // 4 рёберных контракта
  patches: DeformationPatch[];     // применённые патчи
  lastAccess: number;              // performance.now()
  state: 'ready' | 'generating' | 'evictable';
  isVisible: boolean;              // обновляется PlanetRoot каждый кадр
  distanceFromCamera: number;      // обновляется PlanetRoot каждый кадр
  generationPromise: Promise<ChunkGeometry> | null;
}

class CacheSubsystem {
  private map: Map<string, ChunkCacheEntry>;
  private lruList: DoublyLinkedList<string>;
  private maxSize: number;
  private boundaryEngine: BoundaryContractEngine;
  private deformationSystem: DeformationSystem;
}
```

**Memory footprint:** ~40 байт на entry в map + размер ChunkGeometry (~19 KiB при RES=16) + GPU-память меша (~40 KiB). При maxSize=1000: ~60 MiB total (основная память + GPU).

## 3. Производительность

| Операция | Complexity | ~Time |
|----------|-----------|-------|
| `get` | O(1) | ~2 µs |
| `has` | O(1) | ~1 µs |
| `put` (без evict) | O(1) | ~3 µs |
| `evict(1)` | O(N log N) | ~100 µs (при N=1000) |
| `writePatch` | O(vertices) | ~5 ms |
| `dispose` | O(N) | ~10 ms (1000 entries × 10 µs dispose) |

## 4. Интеграция с Babylon.js

```ts
// Только в evict/dispose/put-overwrite:
mesh.dispose();        // Освобождает GPU-буферы
material.dispose();    // Освобождает материал
// В writePatch:
mesh.updateVerticesData(positions);  // Обновляет GPU-буфер без пересоздания
```

## 5. Обработка ошибок

| Условие | Поведение |
|---------|-----------|
| Кэш пуст | `get` → undefined, `evict(1)` → [] |
| `maxSize = 0` | Кэш всегда пуст, `get` всегда undefined |
| Дублирующийся chunkId в `put` | Старая запись disposed, новая вставляется |
| `state = 'generating'` | `get` возвращает entry с `generationPromise` — потребитель ждёт Promise |
| Зацикленное вытеснение (count > maxSize) | Вытесняются все записи |
| `put` бросает исключение | PlanetRoot в try/catch: `mesh.dispose()`, `material.dispose()` (R-016) |

## 6. Состояния ChunkCacheEntry

```
  [generating] ──generate complete──→ [ready]
       ↑                                    │
       │                                    ├── merge (PlanetRoot) ──→ [evictable]
       │                                    │                            │
       │                                    │                            ▼
       │                                    │                      [removed]
       │                                    │
       └── eviction ────────────────────────┘
```

- **generating:** геометрия в процессе генерации, `generationPromise` активен
- **ready:** меш в сцене, чанк активен
- **evictable:** помечен после merge — первый кандидат на вытеснение
- **removed:** запись удалена из кэша

## Ссылки

- Requirement spec: `docs/LOD/07-cache-subsystem.md`
- Используется: PlanetRoot, DeformationSystem (write-through)
