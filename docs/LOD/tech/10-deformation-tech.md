# Техническая спецификация — DeformationSystem

> **Статус:** будущее. Минимальный skeleton. Большинство деталей будут уточнены
> при реализации.

## 1. Алгоритмы

### 1.1 applyPatch

```
applyPatch(patch: DeformationPatch) → void
  // Найти чанк в кэше
  entry = cache.get(patch.chunkId)
  if entry is undefined:
    // Чанк не в кэше — сохранить патч в persistent-слой
    persistentLayer.storePendingPatch(patch)
    return

  // Применить дифф к геометрии
  for each diff in patch.heightDiffs:
    vertexIdx = diff.vertexIndex
    entry.geometry.positions[vertexIdx * 3 + 2] += diff.delta  // radial displacement
    // Инвалидировать нормали затронутых вершин
    invalidateNormals(entry.geometry, diff.vertexIndex, patch.radius)

  // Обновить меш (GPU upload)
  entry.mesh.updateVerticesData(entry.geometry.positions)
  entry.mesh.updateVerticesData(entry.geometry.normals)
  entry.patches.push(patch)

  // Write-through в persistent-слой
  persistentLayer.writePatch(patch.chunkId, patch)
```

### 1.2 reconstruct (базовая геометрия + патчи)

```
reconstruct(chunkId, baseGeometry) → ChunkGeometry
  patches = persistentLayer.getPatches(chunkId)
  geometry = cloneGeometry(baseGeometry)
  for each patch in patches:
    for each diff in patch.heightDiffs:
      apply diff to geometry
  return geometry
```

### 1.3 Сериализация

```
serializePatches() → ArrayBuffer
  // Упаковка всех патчей в линейный буфер
  // Формат: [count: u32] [patch1_header: 16 bytes] [diff1_0, diff1_1, ...] [patch2_header] ...
  buffer = new ArrayBuffer(totalSize)
  view = new DataView(buffer)
  view.setUint32(0, patches.length)
  offset = 4
  for each patch in patches:
    header = encodePatchHeader(patch)
    buffer.set(header, offset); offset += 16
    for each diff in patch.heightDiffs:
      view.setUint32(offset, diff.vertexIndex); offset += 4
      view.setFloat32(offset, diff.delta); offset += 4
  return buffer

deserializePatches(data: ArrayBuffer) → void
  // Обратная процедура
```

## 2. Структуры данных

```ts
interface DeformationPatch {
  id: string;
  chunkId: string;
  type: 'crater' | 'excavation' | 'construction' | 'tunnel' | 'road';
  center: Vector3;           // мировые координаты центра воздействия
  radius: number;            // радиус воздействия в метрах
  heightDiffs: HeightDiff[]; // дифф высот (diff storage — только изменения)
  timestamp: number;         // когда применён
}

interface HeightDiff {
  vertexIndex: number;  // индекс в positions массиве
  delta: number;        // изменение высоты (метры, ±)
  oldValue: number;     // для возможности отката
}

class DeformationSystem {
  private cache: CacheSubsystem;
  private generator: ChunkGenerator;
  private persistentLayer: PersistentPatchLayer;

  constructor(cache, generator) { ... }

  applyPatch(patch: DeformationPatch): void;
  getPatchesForChunk(chunkId: string): DeformationPatch[];
  reconstruct(chunkId: string, baseGeometry: ChunkGeometry): ChunkGeometry;
  serializePatches(): ArrayBuffer;
  deserializePatches(data: ArrayBuffer): void;
  isRoundTripValid(chunkId: string): boolean;
}
```

**Diff storage:** хранится только `(vertexIndex, delta)` — не полная копия геометрии. При 10 патчах по 20 вершин: `10 × 20 × (4+4) = 800 байт` диффа против `~19 KiB` полной геометрии (сжатие ~24×).

## 3. Производительность

| Операция | Complexity | ~Time |
|----------|-----------|-------|
| `applyPatch` (в кэше) | O(affected vertices) | ~2 ms |
| `reconstruct` | O(patches × affected vertices) | ~10 ms |
| `serializePatches` | O(patches × affected vertices) | ~5 ms |

## 4. Интеграция с Babylon.js

```ts
// mesh.updateVerticesData() — обновление GPU-буфера без пересоздания меша
entry.mesh.updateVerticesData(VertexBuffer.PositionKind, entry.geometry.positions);
entry.mesh.updateVerticesData(VertexBuffer.NormalKind, entry.geometry.normals);
```

## 5. Обработка ошибок

| Условие | Поведение |
|---------|-----------|
| Патч к несуществующему чанку | Сохранить в persistent-слой — применится при поднятии чанка |
| Конфликт патчей (два патча меняют одну вершину) | Last-write-wins (order by timestamp) |
| Патч выходит за границы чанка | Обрезать по границе чанка |
| Десериализация битого ArrayBuffer | Ошибка формата с diagnostic |

## 6. Состояния

Stateless. Состояние — в persistent-слое (ArrayBuffer или IndexedDB). Сам DeformationSystem — pure logic.

## Ссылки

- Requirement spec: `docs/LOD/10-deformation.md`
- Архитектурное решение: diff storage (Architecture Decision A)
