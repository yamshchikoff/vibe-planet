# Техническая спецификация — ChunkGenerator

## 1. Алгоритмы

### 1.1 Contract-first генерация рёберных вершин

```
generateSync(request: GenerateRequest) → ChunkGeometry
  RES = request.resolution  // число ячеек на ребро, default 16
  N = RES + 1               // число вершин на ребро
  R = request.planetRadius
  H = request.heightAmplitude

  // 1. Выделить буферы
  positions = new Float32Array(N * N * 3)
  normals = new Float32Array(N * N * 3)
  colors = new Float32Array(N * N * 4)
  heightGrid = new Float32Array(N * N)  // временный — нормализованные высоты
  pbr = new Float32Array(2)             // [roughness, metallic]

  // 2. Заполнить рёберные вершины из контрактов соседей
  fillEdgeVertices(request, positions, heightGrid, RES, R, H)

  // 3. Заполнить внутренние вершины из HeightSampler
  fillInteriorVertices(request, positions, heightGrid, RES, R, H)

  // 4. Вычислить нормали
  computeNormals(positions, heightGrid, normals, RES, R, H, request.face)

  // 5. Вычислить цвета (биомы с domain warp)
  computeBiomeColors(positions, colors, normals, heightGrid, RES, R, request.seed)

  // 6. Усреднить PBR
  pbr[0] = avgRoughness; pbr[1] = avgMetallic

  // 7. Построить индексный буфер
  indices = buildIndices(request.face, RES)

  return { positions, normals, colors, indices, pbr }
```

### 1.2 Рёберные вершины (fillEdgeVertices)

```
fillEdgeVertices(request, positions, heightGrid, RES, R, H):
  // 4 ребра: left (col=0), right (col=RES), bottom (row=0), top (row=RES)
  edges = [
    { contract: request.contracts.left,   col: 0,   rowRange: [0, RES] },
    { contract: request.contracts.right,  col: RES, rowRange: [0, RES] },
    { contract: request.contracts.bottom, row: 0,   colRange: [0, RES] },
    { contract: request.contracts.top,    row: RES, colRange: [0, RES] },
  ]

  for each edge in edges:
    if edge.contract is null:
      // Свободное ребро — вычислить из HeightSampler
      for i = 0 to RES:
        uv = i / RES  // [0, 1] вдоль ребра
        dir = uvToDir(request.face, edge.uv(i))
        h = heightSampler.getHeight(dir.x, dir.y, dir.z)
        pos = dir.normalize() * (R + h * H)
        idx = edge.row * N + edge.col  // (или col * N + row для горизонтальных)
        positions[idx] = pos
        heightGrid[idx] = h
    else:
      // Контракт существует — сэмплировать из контракта соседа
      contract = edge.contract
      if contract.depth != request.depth:
        contract = boundaryEngine.resample(contract, request.depth)
      for i = 0 to RES:
        pos = contract.vertexPositions[i]
        h = contract.heightProfile[i]
        idx = edge.index(i)
        positions[idx] = pos
        heightGrid[idx] = h
```

### 1.3 Внутренние вершины (fillInteriorVertices)

```
fillInteriorVertices(request, positions, heightGrid, RES, R, H):
  for row = 1 to RES-1:      // внутренние строки
    for col = 1 to RES-1:    // внутренние колонки
      u = (request.tx + col/RES) / 2^request.depth * 2 - 1
      v = (request.ty + row/RES) / 2^request.depth * 2 - 1
      dir = uvToDir(request.face, u, v)
      dirNorm = dir.normalize()

      h = heightSampler.getHeight(dirNorm.x, dirNorm.y, dirNorm.z)
      pos = dirNorm * (R + h * H)

      idx = row * N + col
      positions[idx * 3]     = pos.x
      positions[idx * 3 + 1] = pos.y
      positions[idx * 3 + 2] = pos.z
      heightGrid[idx] = h
```

### 1.4 Нормали (computeNormals)

Формула нормали с учётом рельефа (см. B-009):

```
N = D − (H / R) × (∂h/∂u · ∂D/∂u + ∂h/∂v · ∂D/∂v)
```

Где:
- `D` — нормализованный вектор из центра планеты к вершине
- `H / R` — отношение амплитуды высоты к радиусу (критический коэффициент!)
- `∂h/∂u, ∂h/∂v` — производные высоты центральными разностями по сетке чанка
- `∂D/∂u, ∂D/∂v` — производные направления через `uvToDirTangent`

```
computeNormals(positions, heightGrid, normals, RES, R, H, face):
  for row = 0 to RES:
    for col = 0 to RES:
      idx = row * N + col

      // Производные высоты (центральные разности, с учётом контрактов на границах)
      dh_du = centralDiffU(heightGrid, row, col, RES)
      dh_dv = centralDiffV(heightGrid, row, col, RES)

      // Направление из центра планеты
      D = positions[idx].normalize()

      // Производные направления
      u = ..., v = ...  // UV для этой вершины
      dD_du = uvToDirTangent(face, u, v, D, direction='u')
      dD_dv = uvToDirTangent(face, u, v, D, direction='v')

      // Формула нормали
      N = D.subtract(
        dD_du.scale(dh_du * H / R).add(
        dD_dv.scale(dh_dv * H / R))
      ).normalize()

      normals[idx * 3]     = N.x
      normals[idx * 3 + 1] = N.y
      normals[idx * 3 + 2] = N.z
```

**Коэффициент H/R критически важен.** Без него нормали на крутых склонах (горы) будут неверно ориентированы. При H=8 km и R=6371 km: H/R ≈ 0.00125. Это малая величина, но на масштабе вершин (~1 км) наклон существенен.

### 1.5 Биомное окрашивание (computeBiomeColors)

```
computeBiomeColors(positions, colors, heightGrid, RES, R, seed):
  for each vertex i:
    pos = positions[i]
    h = heightGrid[i]      // нормализованная высота [0, 1]
    lat = asin(pos.y / R)  // широта в радианах

    // Domain warp: возмущение границ биомов
    warp = heightSampler.getBiomeWarp(pos.x, pos.y, pos.z, octaves=4)
    hWarped = clamp(h + warp * biomeWarpAmplitude, 0, 1)  // biomeWarpAmplitude = 0.035

    // Карта биомов
    [r, g, b] = getBiomeColor(hWarped, lat)

    colors[i * 4]     = r
    colors[i * 4 + 1] = g
    colors[i * 4 + 2] = b
    colors[i * 4 + 3] = 1.0  // alpha
```

**Карта биомов** (пороги по высоте, сдвинуты широтой):

| hWarped (adjusted) | Широта | Биом | Цвет |
|---------------------|---------|------|------|
| < 0.15 | любая | Ocean | (0.1, 0.2, 0.5) |
| 0.15–0.20 | любая | Shallow | (0.2, 0.5, 0.6) |
| 0.20–0.30 | любая | Sand | (0.76, 0.70, 0.50) |
| 0.30–0.45 | < 60° | Grass | (0.28, 0.50, 0.20) |
| 0.30–0.45 | ≥ 60° | Tundra | (0.40, 0.45, 0.35) |
| 0.45–0.60 | любая | Forest | (0.15, 0.35, 0.10) |
| 0.60–0.80 | любая | Rock | (0.45, 0.43, 0.40) |
| > 0.80 | < 60° | Snow | (0.95, 0.95, 0.95) |
| > 0.80 | ≥ 60° | Ice | (0.90, 0.93, 0.98) |

Межбиомные границы интерполируются smoothstep с шириной перехода ~0.02 высоты.

### 1.6 Индексный буфер (buildIndices)

```
buildIndices(face, RES) → Uint32Array
  // triangle list, CCW front face (Babylon.js left-handed)
  // Два треугольника на ячейку сетки
  // RES^2 ячеек × 2 треугольника × 3 индекса = RES^2 * 6

  indices = new Uint32Array(RES * RES * 6)
  idx = 0
  for row = 0 to RES-1:
    for col = 0 to RES-1:
      tl = row * N + col          // top-left
      tr = row * N + col + 1      // top-right
      bl = (row + 1) * N + col    // bottom-left
      br = (row + 1) * N + col + 1  // bottom-right

      if FACE_WINDING_FLIP[face]:
        // CW winding → flip to CCW
        indices[idx..idx+5] = [tl, bl, br,  tl, br, tr]
      else:
        // CCW winding
        indices[idx..idx+5] = [tl, tr, br,  tl, br, bl]

      idx += 6

  return indices
```

**FACE_WINDING_FLIP:** грани -Y и +Z куба дают CW winding (вершины обходятся по часовой). Для консистентного CCW фронта во всей сцене winding этих граней инвертируется.

### 1.7 Построение меша (buildMesh)

```
buildMesh(geometry: ChunkGeometry, scene: Scene, name: string) → Mesh
  mesh = new Mesh(name, scene)
  vertexData = new VertexData()
  vertexData.positions = geometry.positions
  vertexData.normals = geometry.normals
  vertexData.colors = geometry.colors
  vertexData.indices = geometry.indices
  vertexData.applyToMesh(mesh, true)  // true = updatable (для deformation)

  mesh.useVertexColors = true

  // PBRMaterial: per-chunk roughness/metallic
  mat = new PBRMaterial(name + '_mat', scene)
  mat.roughness = geometry.pbr[0]
  mat.metallic = geometry.pbr[1]
  mat.clearCoat.isEnabled = true
  mat.clearCoat.intensity = 0.04
  mat.sideOrientation = 0  // CCW

  mesh.material = mat
  mesh.receiveShadows = true

  return mesh
```

### 1.8 verifyRoundTrip (instance method)

```
verifyRoundTrip(request: GenerateRequest) → boolean
  // Генерирует чанк дважды и сравнивает
  g1 = generateSync(request)
  g2 = generateSync(request)

  // Сравнение positions с tolerance
  if g1.positions.length != g2.positions.length: return false
  for i = 0 to positions.length - 1:
    if abs(g1.positions[i] - g2.positions[i]) > ε_position:
      return false

  // Аналогично normals
  return true
```

Использует `this.heightSampler` (не статический — экземпляр уже владеет HeightSampler).

## 2. Структуры данных

```ts
interface ChunkGeometry {
  positions: Float32Array;  // (RES+1)² × 3 floats
  normals: Float32Array;    // (RES+1)² × 3 floats
  colors: Float32Array;     // (RES+1)² × 4 floats [r, g, b, a]
  indices: Uint32Array;     // RES² × 6 indices (triangle list, CCW)
  pbr: Float32Array;        // 2 floats [roughness, metallic] per mesh
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
  private heightSampler: HeightSampler;
  private asyncScheduler: AsyncJobScheduler;
  private boundaryEngine: BoundaryContractEngine;
}
```

**Memory footprint генерации при RES=16:**
| Буфер | Элементов | Байт |
|-------|----------|------|
| positions | 289 × 3 = 867 | 3,468 |
| normals | 289 × 3 = 867 | 3,468 |
| colors | 289 × 4 = 1,156 | 4,624 |
| indices | 256 × 6 = 1,536 | 6,144 (Uint32) |
| pbr | 2 | 8 |
| heightGrid (temp) | 289 | 1,156 |
| **Total** | | **~19 KiB** |

При RES=32: ~75 KiB. Бюджет памяти M(d) = размер ChunkGeometry + размер меша (GPU-side ~2×).

## 3. Производительность

| Фаза | RES=16 | RES=32 | Доминирующий фактор |
|------|--------|--------|---------------------|
| fillEdgeVertices | ~2 ms | ~8 ms | BoundaryContractEngine.resample (4 edges) |
| fillInteriorVertices | ~15 ms | ~60 ms | HeightSampler.getHeight (FBM 12 octaves) |
| computeNormals | ~3 ms | ~12 ms | central differences + uvToDirTangent |
| computeBiomeColors | ~4 ms | ~16 ms | getBiomeWarp (4 octaves per vertex) |
| buildIndices | ~0.5 ms | ~2 ms | pure loops |
| buildMesh | ~3 ms | ~10 ms | GPU upload (VertexData.applyToMesh) |
| **Total sync** | **~28 ms** | **~108 ms** | |

- При RES=16: ~28 ms > бюджет кадра (16.6 ms) → async dispatch для большинства чанков
- При RES=16 с кэшированными контрактами соседей: ~25 ms
- FBM-сэмплирование (fillInteriorVertices) — 50-60% общего времени
- buildMesh — на главном потоке всегда (GPU-bound, не может быть в Worker)

## 4. Интеграция с Babylon.js

```ts
// Только в buildMesh:
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';

// Шаги:
// 1. new Mesh(name, scene)
// 2. new VertexData() → заполнить буферы → applyToMesh(mesh, updatable=true)
// 3. new PBRMaterial(name, scene) → roughness, metallic, clearCoat
// 4. mesh.material = mat
// 5. mesh.setParent(planetRootTransformNode) — ДЕЛАЕТСЯ В PlanetRoot, НЕ в ChunkGenerator
```

**Важно:** `mesh.setParent()` вызывается PlanetRoot после buildMesh. ChunkGenerator не знает о структуре сцены — он только производит Mesh.

## 5. Обработка ошибок

| Условие | Поведение |
|---------|-----------|
| `resolution < 2` | Ошибка: минимум 2 вершины на ребро |
| `heightAmplitude = 0` | Идеальная сфера: все высоты 0, нормали = dir |
| `planetRadius = 0` | Fallback к 1 |
| Все 4 контракта отсутствуют | Корневые чанки (depth=0) — первичная генерация без контрактов |
| `seed` изменился между вызовами | Не должен — seed фиксирован в контракте и GenerateRequest |
| Async отменён (телепортация) | `generateAsync` поддерживает AbortSignal, Promise rejected with AbortError |
| Worker упал в процессе генерации | AsyncJobScheduler пересоздаёт Worker, задание возвращается в очередь |

## 6. Состояния

Stateless generator. Все состояния — в запросе (GenerateRequest), результате (ChunkGeometry), и внешнем кэше. ChunkGenerator — чистая функция: вход → выход.

## Ссылки

- Requirement spec: `docs/LOD/05-chunk-generator.md`
- Использует: HeightSampler, BoundaryContractEngine, AsyncJobScheduler
- Баги: B-009 (normal gradient scale — коэффициент H/R критичен)
