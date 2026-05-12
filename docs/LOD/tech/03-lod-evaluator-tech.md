# Техническая спецификация — LODEvaluator

## 1. Алгоритмы

### 1.1 Screen-space размер чанка

```
evaluate(node: QuadNode, camera: CameraParams) → LODEvaluation
  // 1. Вычислить 4 угла чанка в мировых координатах
  //    UV квадрата: (u0,v0) левый-нижний, (u1,v1) правый-верхний
  u0 = (node.tx / 2^node.depth) * 2 - 1
  v0 = (node.ty / 2^node.depth) * 2 - 1
  u1 = ((node.tx + 1) / 2^node.depth) * 2 - 1
  v1 = ((node.ty + 1) / 2^node.depth) * 2 - 1

  corners = [
    uvToDir(node.face, u0, v0).normalize() * R,
    uvToDir(node.face, u1, v0).normalize() * R,
    uvToDir(node.face, u0, v1).normalize() * R,
    uvToDir(node.face, u1, v1).normalize() * R,
  ]

  // 2. Измерить 4 ребра, взять максимальное (консервативная оценка)
  edgeWorld = max(
    |corners[1] - corners[0]|,  // bottom edge
    |corners[3] - corners[2]|,  // top edge
    |corners[2] - corners[0]|,  // left edge
    |corners[3] - corners[1]|,  // right edge
  )

  // 3. Расстояние от камеры до центра чанка
  center = (corners[0] + corners[1] + corners[2] + corners[3]) / 4
  distance = |center - camera.position|

  // 4. Screen-space проекция
  //    Размер в пикселях = (world size / distance) × (pixels per radian)
  pixelsPerRadian = camera.viewportHeightPx / (2 * tan(camera.fovRadians / 2))
  screenSizePx = (edgeWorld / distance) * pixelsPerRadian

  // 5. Split/merge сигналы
  shouldSplit = screenSizePx > splitThreshold(node.depth) AND node.depth < maxDepth
                AND node.state != 'split'
  shouldMerge = node.state == 'split'
                AND allChildrenScreenPx < mergeThreshold(node.depth)
  isVisible = NOT isBelowHorizon(center, camera.position, R)
              AND isInFrustum(center, edgeWorld/2, camera)

  return { screenSizePx, shouldSplit, shouldMerge, isVisible }
```

**Почему max ребро, а не среднее:** консервативная оценка предотвращает недооценку screen-space размера для вытянутых чанков у краёв грани куба. Если использовать среднее или минимальное ребро, угловые чанки могут недополучить split — игрок увидит крупные треугольники.

### 1.2 Кэширование edgeWorld

Величина `edgeWorld` для заданного (face, depth) **не зависит от tx, ty в первом приближении** — все чанки одного face и depth имеют примерно одинаковый размер. Погрешность до ~30% для угловых чанков (tx/ty близки к 0 или 2^depth на низких глубинах), но для LOD-решения погрешность приемлема.

```ts
// Кэш: Map<string, number> с ключом "f{face}-d{depth}"
private edgeWorldCache: Map<string, number>;

getEdgeWorld(face: number, depth: number): number {
  const key = `f${face}-d${depth}`;
  let cached = this.edgeWorldCache.get(key);
  if (cached !== undefined) return cached;

  // Вычислить для центрального чанка грани (tx=2^(depth-1), ty=2^(depth-1))
  const mid = 2 ** (depth - 1);
  const u0 = (mid / 2**depth) * 2 - 1;
  // ... вычислить 4 угла, измерить max ребро
  this.edgeWorldCache.set(key, cached);
  return cached;
}
```

### 1.3 Экспоненциальные пороги split/merge

```
splitThreshold(depth) = 1.0 + A * exp(-depth / B)
mergeThreshold(depth) = 1.0 - C * exp(-depth / D)
```

Константы по умолчанию: A=0.5, B=2.0, C=0.3, D=2.0.

| depth | splitThreshold | mergeThreshold | Гистерезис |
|-------|---------------|----------------|-----------|
| 0 | 1.50 px | 0.70 px | 0.80 px |
| 1 | 1.30 px | 0.82 px | 0.48 px |
| 2 | 1.18 px | 0.89 px | 0.29 px |
| 3 | 1.11 px | 0.93 px | 0.18 px |
| 6 | 1.02 px | 0.98 px | 0.04 px |
| 9 | 1.006 px | 0.996 px | 0.01 px |
| 12 | 1.001 px | 0.999 px | 0.002 px |

**Свойства:**
- На малых глубинах (0–3): широкий гистерезис предотвращает джиттер (split-merge-split) при движении камеры
- На больших глубинах (8–12): жёсткая сходимость к 1.0 px — предотвращает pop-in на мелких масштабах
- Экспоненциальная форма гарантирует робастность на любых скоростях без адаптации к скорости

### 1.4 Горизонтная видимость

```
isBelowHorizon(chunkCenter, cameraPos, R) → boolean
  // Вектор от центра планеты к камере
  toCamera = cameraPos.normalize()
  // Расстояние от центра до камеры
  camDist = |cameraPos|
  // Высота камеры над поверхностью
  altitude = camDist - R

  // Угол горизонта: cos(θ) = R / (R + altitude)
  cosHorizon = R / camDist

  // Косинус угла между toCamera и направлением на чанк
  toChunk = chunkCenter.normalize()
  cosAngle = dot(toCamera, toChunk)

  // Чанк за горизонтом, если его угол больше горизонта
  return cosAngle < cosHorizon
```

Касательная к горизонту: чанк на границе горизонта считается видимым (запас в сторону видимости).

### 1.5 Фрустум-видимость (упрощённая)

```
isInFrustum(chunkCenter, boundingRadius, camera) → boolean
  // Bounding sphere against 6 frustum planes
  // Для каждого plane: signedDistance = dot(plane.normal, center) + plane.d
  // Если signedDistance < -boundingRadius → outside
  // Используется Babylon.js camera.getFrustumPlanes()
  for each plane in camera.frustumPlanes:
    if dot(plane.normal, chunkCenter) + plane.d < -boundingRadius:
      return false
  return true
```

### 1.6 Массовая оценка (evaluateBatch)

```
evaluateBatch(nodes: QuadNode[], camera: CameraParams) → Map<string, LODEvaluation>
  // cameraParams инвариантен для всех узлов в одном кадре
  // pixelsPerRadian вычисляется один раз
  for each node in nodes:
    result = evaluate(node, camera)
    results.set(node.id, result)
  return results
```

## 2. Структуры данных

```ts
interface CameraParams {
  position: Vector3;         // мировые координаты камеры
  fovRadians: number;        // вертикальный FOV в радианах
  viewportWidthPx: number;   // ширина canvas в пикселях
  viewportHeightPx: number;  // высота canvas в пикселях
  nearPlane: number;         // ближняя плоскость отсечения
  farPlane: number;          // дальняя плоскость отсечения
}

interface LODEvaluation {
  screenSizePx: number;   // максимальный размер ребра в пикселях
  shouldSplit: boolean;   // нужен split
  shouldMerge: boolean;   // нужен merge
  isVisible: boolean;     // в frustum + над горизонтом
}

class LODEvaluator {
  private planetRadius: number;
  private edgeWorldCache: Map<string, number>;  // "f{face}-d{depth}" → meters
  // Константы порогов
  private A: number = 0.5;
  private B: number = 2.0;
  private C: number = 0.3;
  private D: number = 2.0;
}
```

**Memory footprint:** ~100 байт на экземпляр + кэш (6 граней × 13 глубин × 8 байт ≈ 624 байт).

## 3. Производительность

| Операция | Complexity | ~Time |
|----------|-----------|-------|
| `evaluate` | O(1) | ~5 µs |
| `evaluateBatch` | O(N) | ~N × 5 µs |
| `isBelowHorizon` | O(1) | ~2 µs |
| `isInFrustum` | O(1) | ~3 µs |

- `edgeWorldCache` сокращает 4 `uvToDir` + 4 `|vector|` до одного lookup — экономия ~80% времени evaluate
- При 1000 узлов на кадр: ~5 ms на всю LOD-оценку

## 4. Интеграция с Babylon.js

```ts
// Извлечение CameraParams из Babylon.js Camera
function extractCameraParams(camera: Camera, engine: Engine): CameraParams {
  return {
    position: camera.position.clone(),
    fovRadians: camera.fov,                          // Babylon.js Camera.fov в радианах
    viewportWidthPx: engine.getRenderWidth(),
    viewportHeightPx: engine.getRenderHeight(),
    nearPlane: camera.minZ,
    farPlane: camera.maxZ,
  };
}
```

`isInFrustum` использует `camera.getFrustumPlanes()` для получения 6 плоскостей.

## 5. Обработка ошибок

| Условие | Поведение |
|---------|-----------|
| `distance = 0` (камера внутри чанка) | screenSizePx → ∞, shouldSplit = true |
| `fovRadians = 0` | pixelsPerRadian → ∞, screenSizePx → ∞ |
| `viewportHeight = 0` | pixelsPerRadian = 0, screenSizePx = 0 |
| `node.depth ≥ maxDepth` | shouldSplit всегда false |
| Планета вне frustum | Все чанки невидимы — traverseOccluded всё равно работает (REQ-003) |

## 6. Состояния

Stateless. Кэш `edgeWorldCache` — мемоизация без побочных эффектов, может быть очищен в любой момент.

## Ссылки

- Requirement spec: `docs/LOD/03-lod-evaluator.md`
- Используется: PlanetRoot (покадровый цикл)
