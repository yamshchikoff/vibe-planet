# Баг-трекер

## B-008: Солнце — 2D billboard disc без depth, просвечивает сквозь планету

**Дата:** 2026-05-08
**Компонент:** `src/atmosphere/Sun.ts`
**Severity:** major (визуально артефакт — солнце видно сквозь планету)
**Статус:** resolved

**Ключевые слова:** `sun disc`, `billboard`, `createSunDisc`, `renderingGroupId`, `depth test`, `occlusion`

### Симптомы

Солнце — 2D-диск (билборд) с радиальным градиентом и `renderingGroupId = 2`.
Из-за этого:
1. **Солнце просвечивает сквозь планету** — билборд рендерится поверх всего, игнорируя z-buffer
2. **Орбитальное движение создаёт иллюзию** — солнце движется по малой орбите вокруг самолёта, а не планеты
3. **Нет ощущения космической дистанции** — диск всегда направлен на камеру, нет параллакса

### Fix

Полная замена системы солнца:

1. **2D billboard disc → 3D sphere**. `MeshBuilder.CreateSphere` с 32 сегментами.
   - Радиус сферы: `SUN_DISTANCE * tan(0.265°) ≈ 2312.5`
   - Дистанция: 500,000 юнитов (78 радиусов планеты)
   - Угловой диаметр: 0.53° — как у реального Солнца с Земли

2. **Без `renderingGroupId`** — сфера в группе 0, участвует в depth test.
   Планета корректно заслоняет солнце, когда оно за ней.

3. **Статичная сцена** — солнце неподвижно, орбитальное движение убрано.
   `update()` — no-op.

4. **Материал**: `StandardMaterial` с `emissiveColor = (1, 0.95, 0.7)` (тёплый жёлтый),
   `disableLighting = true`.

5. **DirectionalLight** инициализируется один раз в конструкторе, направление не меняется.

6. **`HemisphericLight.direction`** указывает в сторону солнца с самого создания.

### Параметры

| Параметр | Значение | Пояснение |
|----------|----------|-----------|
| `SUN_DISTANCE` | 500,000 | 78.5× радиуса планеты |
| `SUN_SPHERE_RADIUS` | ~2,312.5 | `500000 * tan(0.265°)` |
| `SUN_ANGULAR_RADIUS` | 0.265° | Реальный угловой радиус Солнца |
| Far plane (`cam.maxZ`) | 2,000,000 (был уже) | Установлен в SceneManager |
| Z-buffer separation | ~2,600 значений | Между 6371 и 500,000 при far=2e6 |

### Верификация

- `npm test` — Sun: 6 passed (восстановлены после замены моков)
- `npx tsc --noEmit` — 0 errors
- Солнце — жёлтая сфера, висящая в космосе
- Планета заслоняет солнце при нахождении между камерой и солнцем
- Свет (`DirectionalLight`) приходит с той же стороны, что и сфера

### Применённые фиксы

| Файл | Изменение |
|------|-----------|
| `src/atmosphere/Sun.ts` | `createSunDisc()` → `createSunSphere()`, статичная сцена |
| `src/atmosphere/Sun.test.ts` | Моки под `CreateSphere`, тесты без орбиты |
| `src/main.ts` | `sun.getSunDisc` → `sun.getSunSphere`, удалён `sun.update(dt)` |

---

## B-007: Ночная сторона планеты не затемняется — HemisphericLight заливает тени

**Дата:** 2026-05-08
**Компонент:** `src/atmosphere/Sun.ts`
**Severity:** major (планета не показывает day/night terminator)
**Статус:** resolved

**Ключевые слова:** `HemisphericLight`, `DirectionalLight`, `night`, `ambient`, `day/night terminator`, `освещение`

### Симптомы

Планета освещена равномерно — день и ночь на поверхности неразличимы.
Терминатор (граница дня и ночи) отсутствует или едва заметен.
При движении солнца по орбите планета не темнеет с противоположной от солнца стороны.

### Root cause

Две проблемы в `Sun.ts.update()`:

1. **HemisphericLight ночью слишком яркий.** `nightIntensity = 0.12` — даже когда солнце
   за горизонтом, небесная полусфера даёт 12% от полного ambient. С DirectionalLight
   на минимальных 30% это даёт ~150 лк на ночной стороне — глаз видит «серо, но не ночь».

2. **DirectionalLight никогда не выключается.** Интенсивность считалась как
   `1.5 * (0.3 + 0.7 * max(0, sy))` — даже при `sy < 0` (солнце под горизонтом)
   свет оставался на 45% мощности. Ночная сторона планеты получала прямой свет.

3. **HemisphericLight.direction фиксирован в (0,1,0).** «Небо» всегда сверху, независимо
   от положения солнца. Это создаёт ровный верхний свет, который не дает теням проявиться.

### Fix

1. `nightIntensity`: `0.12` → `0.02` (едва заметный звёздный свет)
2. Directional intensity: `0.3 + 0.7 * max(0, sy)` → `1.0 * max(0, sy)` —
   когда солнце за горизонтом, DirectionalLight вклада не даёт
3. `this.hemi.direction.copyFrom(this.direction)` — полусфера вращается за солнцем,
   «небесный» свет всегда приходит со стороны солнца, «земной» — с противоположной

### Верификация

- `npm run dev` → браузер → на планете виден чёткий терминатор
- Ночная сторона тёмная (но не абсолютно чёрная — 2% ambient остаётся)
- Терминатор движется по планете при движении солнца по орбите

### Применённые фиксы

| Файл | Строка | Изменение |
|------|--------|-----------|
| `src/atmosphere/Sun.ts` | ~115 | `nightIntensity`: 0.12 → 0.02 |
| `src/atmosphere/Sun.ts` | ~109 | Directional intensity: `0.3+0.7*h` → `1.0*h` |
| `src/atmosphere/Sun.ts` | ~112 | `this.hemi.direction.copyFrom(this.direction)` добавлен |

---

## B-006: Вывернутая сфера — CCW-геометрия отсекается как back faces в Babylon.js v9 left-handed scene

**Дата:** 2026-05-08
**Компонент:** `src/planet/LODPlanet.ts:generateChunk()`
**Severity:** critical (планета рендерилась изнутри, снаружи — прозрачная)
**Статус:** resolved

**Ключевые слова:** `sideOrientation`, `winding order`, `back face culling`, `CW`, `CCW`, `left-handed scene`, `Babylon.js v9`, `Mesh constructor`, `effectiveOrientation`

### Симптомы

Планета выглядит прозрачной при взгляде снаружи — видна только внутренняя поверхность.
OpenCV-анализ скриншота: 775,427 content-пикселей (много), но визуально это внутренность сферы.
При взгляде снаружи сфера кажется пустой/прозрачной.

CDP-верификация:
- `engine.cullBackFaces` = `true`
- `mat.backFaceCulling` = `true`
- Все нормали направлены наружу (100% outward, проверено через cross product)
- Все 6 граней имеют чанки с правильными инвариантами I1–I5

### Root cause

Babylon.js v9 (`@babylonjs/core@^9.5.2`) создаёт сцену в left-handed системе по умолчанию
(`useRightHandedSystem = false`). В конструкторе Mesh (`mesh.ts:555-558`) это приводит
к установке `mesh.sideOrientation = 1` (Material.ClockWiseSideOrientation):

```typescript
// mesh.ts (Babylon.js v9)
if (this._scene.useRightHandedSystem) {
    this.sideOrientation = 0;  // CCW = front face
} else {
    this.sideOrientation = 1;  // CW = front face
}
```

Когда материал создаётся без явного `sideOrientation` (остаётся `null`), Babylon.js
вызывает `_getEffectiveOrientation(mesh)`, который возвращает `mesh.sideOrientation = 1`.
Это означает: `CW = front face`, `CCW = back face`.

Наша геометрия генерируется с CCW winding (проверено: cross product двух рёбер треугольника
даёт вектор, совпадающий с направлением наружу от сферы). В результате все треугольники
трактуются как back faces и отсекаются back face culling. Рендерится только внутренняя
поверхность сферы (там winding зеркальный, CCW снаружи = CW изнутри).

### Fix

Явно установить `mat.sideOrientation = 0` (Material.CounterClockWiseSideOrientation)
на PBRMaterial чанков. Это переопределяет mesh-дефолт и говорит движку, что
CCW-треугольники — лицевые:

```typescript
const mat = new PBRMaterial(`mat-${faceIdx}-${depth}-${tx}-${ty}`, this.scene);
mat.sideOrientation = 0; // CCW = front face (override для left-handed сцены)
```

### Почему не сработали другие подходы

| Подход | Результат |
|--------|-----------|
| `mat.backFaceCulling = false` | Сфера видна, но теряется производительность (рендерятся обе стороны) и появляются артефакты на стыках |
| Развернуть индексы треугольников | Потребовалось бы менять генерацию во всех 6 faces, править `FACE_WINDING_FLIP` |
| `mesh.sideOrientation = 0` | Mesh-свойство перезаписывается при каждом dispose/recreate. Правильный уровень — материал |

### Верификация

До фикса:
- `effectiveOrientation = 1` (CW = front face)
- 775,427 content-пикселей на скриншоте (внутренность сферы)
- При culling = false: видна двойная стенка (передняя и задняя поверхность)

После фикса:
- `effectiveOrientation = 0` (CCW = front face)
- 154,000 content-пикселей (только передняя полусфера, задняя правильно отсечена)
- Culling = true: задняя полусфера не рендерится (как и должно быть)

### Применённые фиксы

| Файл | Строка | Изменение |
|------|--------|-----------|
| `src/planet/LODPlanet.ts` | ~330 | `mat.sideOrientation = 0` добавлено после создания PBRMaterial |

---

## B-004: Планета «кривая» — чанки в космосе, дыры на поверхности

**Дата:** 2026-05-08
**Компонент:** `src/planet/LODPlanet.ts`, `src/planet/HeightSampler.ts`
**Severity:** critical
**Статус:** resolved

**Ключевые слова:** `LODPlanet`, `generateChunk`, `uvToDir`, `height sampling`, `cube-sphere`, `normalize`, `инварианты`, `vertex position`

### Симптомы

Чанки планеты появляются в космосе (на неправильных позициях), на поверхности планеты — квадратные дыры. При движении чанки «отваливаются» от планеты и перегенерируются в неправильных местах.

### Методология отладки

**Без камеры и скриншотов.** Отладка генерации планеты ведётся через:
1. Программное перемещение корабля (CDP `Runtime.evaluate`)
2. Анализ структур данных чанков (vertex positions, bounding boxes)
3. Проверку инвариантов для каждого активного чанка

### Инварианты чанков

| # | Инвариант | Проверка |
|---|----------|----------|
| I1 | **Радиальная дистанция вершин:** каждая вершина чанка должна быть на расстоянии `[R, R + heightAmp]` от центра планеты (0,0,0) в абсолютных координатах | `sqrt(vx² + vy² + vz²)` ∈ [6371, 6379] |
| I2 | **Количество вершин:** чанк с resolution `res` содержит ровно `(res+1)²` вершин | `vertexCount === 289` (для res=16) |
| I3 | **Валидность нормалей:** все нормали — единичные векторы | `abs(length(n) - 1) < 1e-5` |
| I4 | **Face origin:** вершины чанка face 0 (+X) имеют положительную X-компоненту в локальных координатах | `vx > 0` для чанков f0 |
| I5 | **Непрерывность координат на стыках чанков:** угол/ребро одного чанка и угол/ребро соседнего чанка, представляющие одну и ту же точку на сфере, имеют **одинаковые координаты** (x, y, z) — не только высоту, а все три компоненты | сравнить positions на границе соседних чанков |

### Гипотезы

1. **Высота семплируется на кубе вместо сферы** — `uvToDir` возвращает ненормализованный вектор, `samplePos = dir * R` даёт точку на кубе (расстояние до центра > R на рёбрах и углах). **Fix:** `uvToDir(...).normalize()` перед `scale(R)`. **(применён 2026-05-08, верифицирован)**

2. **Инвариант I1 может нарушаться** из-за неправильной работы `_tmpVec` (shared mutable state)

3. **Инвариант I4 может нарушаться** из-за неправильного face mapping в `uvToDir`

### Верификация (2026-05-08)

CDP-верификация всех 5 инвариантов через `Runtime.evaluate` на свежей странице (Chrome dev VM, порт 8081):

| # | Результат | Детали |
|---|-----------|--------|
| I1 | **PASS** | 688 чанков, 198,832 вершин, все в [6372.32, 6379.00] (R=6371, heightAmp=8) |
| I2 | **PASS** | Все проверенные чанки имеют ровно 289 вершин (res=16 → (16+1)²) |
| I3 | **PASS** | 5 выборочных чанков — 0 bad normals (все единичные векторы) |
| I4 | **PASS** | Face 0 (+X): 574 чанков, 0 violations. Face 2 (+Y): 52 чанка, 0 violations |
| I5 | **PASS** | 1050 смежных пар чанков, все continuous, maxDiff = 0.000000 |

OpenCV-анализ скриншота: 851,366 content pixels (~98% экрана) — **CONTENT DETECTED**.

Планета генерируется корректно: вершины на правильных радиальных расстояниях, стыки чанков непрерывны по всем трём координатам.

---

## B-005: Face culling отсекает целые грани — отсутствуют чанки в полярной области

**Дата:** 2026-05-08
**Компонент:** `src/planet/LODPlanet.ts:update()`
**Severity:** critical (пропадали целые грани планеты)
**Статус:** resolved

**Ключевые слова:** `face culling`, `FACE_NORMALS`, `dot product`, `polar hole`, `Y-face`, `traversal`, `update()`

### Симптомы

На экране видна дыра в районе полюса планеты. CDP-аудит face coverage показывает:

```
face 0 (+X): 574 чанков  ← норма (камера рядом)
face 1 (-X):   0 чанков  ← аномалия
face 2 (+Y):  52 чанка   ←可疑 (мало)
face 3 (-Y):   0 чанков  ← !!! ЦЕЛАЯ ГРАНЬ ОТСУТСТВУЕТ
face 4 (+Z):  31 чанк
face 5 (-Z):  31 чанк
```

Faces 1 (-X) и 3 (-Y) имеют 0 чанков — полностью отсечены. При этом при взгляде с экватора часть грани 3 (-Y) должна быть видна.

### Root cause

`LODPlanet.update()` (строка ~212) содержал face culling по нормали грани:

```typescript
for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
  const camDir = _tmpVec.copyFrom(cameraPos).normalize();
  const dot = camDir.dot(FACE_NORMALS[faceIdx]);
  if (dot < -0.2) continue;  // ← отсекает целые грани!
  this.traverseFace(faceIdx, cameraPos, effectiveDepth, 0, 0, 0, needed);
}
```

При положении камеры выше экватора (Y > 0, что характерно для старта над горой
с координатами [5993.87, 2181.71, 0]):
- Face 3 (-Y): `camDir·(0,-1,0) = -0.2` → отсечена полностью
- Face 1 (-X): `camDir·(-1,0,0) = -0.3` → отсечена полностью
- Face 2 (+Y): `camDir·(0,1,0) = 0.2` → не отсечена, но далеко от камеры → всего 52 чанка

Проблема: для планеты (объект радиусом 6371, камера вплотную на расстоянии ~6400 от центра)
все 6 граней кубической сферы всегда имеют некоторую видимую площадь на экране.
Culling по нормали грани недопустим: даже грань, чья нормаль направлена от камеры,
имеет видимые участки (ближе к рёбрам стыка с соседними гранями).

### Почему culling казался хорошей идеей (но не сработал)

Для классического «рассмотреть планету из космоса» камера далеко (50-100 R),
и отсечение обратных граней — норм. Но в симуляторе полёта камера на расстоянии
~0.01 R от поверхности (`cameraPos.length()` ≈ R + 2–100). С такого расстояния
видно небо под любым углом — все 6 граней частично видны.

### Fix

Убран face culling полностью. Все 6 граней всегда обходятся квадродеревом.
`traverseFace` сам определяет уровень детализации по расстоянию от камеры
до центра чанка — дальние грани получают минимальное дробление (глубина 0–2),
ближние — максимальное (глубина 3–12).

```typescript
for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
  this.traverseFace(faceIdx, cameraPos, effectiveDepth, 0, 0, 0, needed);
}
```

Т.к. `traverseFace` уже использует адаптивный LOD по расстоянию, удаление
culling не увеличивает общее число чанков сверх `maxChunks = 1000`.
Пассивные грани получают 1–16 чанков (depth 0–2), что пренебрежимо мало.

Дополнительно удалён неиспользуемый массив `FACE_NORMALS` и константа `_tmpVec`
больше не засоряется лишним `copyFrom` в `update()`.

### Верификация

CDP-аудит face coverage ПОСЛЕ фикса (все 6 граней имеют чанки):

```
face 0 (+X): 574 чанка
face 1 (-X):  16 чанков  ← было 0
face 2 (+Y):  52 чанка
face 3 (-Y):  16 чанков  ← было 0 !
face 4 (+Z):  31 чанк
face 5 (-Z):  31 чанк
```

Инварианты:
- I1: 208,080 вершин, все в [6372.32, 6379.00], 0 bad (R=6371, heightAmp=8)
- I4: 0 нарушений знака оси на всех гранях
- I2: все 720 чанков имеют 289 вершин (res=16 → (16+1)²)
- OpenCV: CONTENT DETECTED (769,451 пиксель)

### Методологическая находка

**Face coverage audit — camera-independent.** Распределение чанков по граням
проверяется через CDP `Runtime.evaluate` по именам мешей (`chunk-f{fi}-...`).
Не требует скриншота, камеры, визуального осмотра. Если на грани 0 чанков —
однозначная аномалия, независимо от положения камеры.

Протокол задокументирован в `docs/skills/visual-debugging.md` (раздел
«Протокол отладки чанков (без камеры и зрения)»).

---

## B-003: Чёрные квадраты на планете — vertex colors не доходят до шейдера

**Дата:** 2026-05-08
**Компонент:** `src/planet/LODPlanet.ts`
**Severity:** major (часть чанков планеты рендерится чёрным)
**Статус:** resolved

**Ключевые слова:** `PBRMaterial`, `VERTEXCOLOR`, `useVertexColors`, `vertex color`, `чёрный квадрат`, `планета`, `чанк`, `шейдер`

### Симптомы

Отдельные чанки планеты отображаются как чёрные квадраты — нет текстур/цвета.
Одновременно новые чанки генерируются в неправильных местах в «космосе»
(визуальная иллюзия из-за того, что чёрные чанки создают видимость отсутствия
поверхности планеты).

### Root cause

`LODPlanet.generateChunk()` создаёт vertex colors через `VertexData.colors` и
применяет их к мешу через `vertexData.applyToMesh(mesh, true)`. Но флаг
`mesh.useVertexColors` никогда не выставляется в `true`.

PBRMaterial в Babylon.js проверяет этот флаг в `materialHelper.functions.js`:
```javascript
const hasVertexColors = mesh.useVertexColors && mesh.isVerticesDataPresent(`color`);
defines["VERTEXCOLOR"] = hasVertexColors;
```

Без `useVertexColors = true` define `VERTEXCOLOR` остаётся `false`, и PBR-шейдер
игнорирует цвета вершин. Материал рендерится с дефолтным тёмным цветом (нет
albedo текстуры, нет base color) — выглядит как чёрный квадрат.

Дополнительно, строка `(mat as unknown as { useVertexColor: boolean }).useVertexColor = true`
не имела эффекта — свойство `useVertexColor` не существует на PBRMaterial.

### Fix

`src/planet/LODPlanet.ts:401` — добавлен `mesh.useVertexColors = true` после
`vertexData.applyToMesh(mesh, true)`. Убрана бесполезная строка с `useVertexColor`.

### Верификация

- CDP: `mesh.useVertexColors = true`, `mesh.isVerticesDataPresent("color") = true`
- OpenCV: 674,770 контентных пикселей, **0% очень тёмных пикселей** (до фикса были десятки тысяч)
- Цветовое распределение: BGR (77, 78, 71) ±32 — хорошее разнообразие биомов

---

## B-002: Невидимый самолёт — меш в `_activeMeshes`, но не рендерится

**Дата:** 2026-05-08
**Компонент:** `src/scene/SceneManager.ts`, `src/plane/PlaneVisual.ts`
**Severity:** major (рендеринг работал частично, plane и другие StandardMaterial-объекты не выдавали пиксели)
**Статус:** resolved

**Ключевые слова:** `UBO`, `uniform buffer`, `invisible mesh`, `_activeMeshes`, `StandardMaterial`, `emissive`, `невидимый объект`, `пустой UBO`, `disableUniformBuffers`, `finalizeSceneUbo`, `SceneUboObject`, `viewProjection`

### Симптомы

Самолёт присутствует в сцене: 6 частей (`"part"`) в `_activeMeshes`, `alwaysSelectAsActiveMesh = true`.
Шейдеры компилируются без ошибок, draw calls выполняются. Но на экране — ноль пикселей,
принадлежащих самолёту. Clear color `#050510` — только фон.

OpenCV-анализ скриншота через `debug-cycle.sh` → **NO CONTENT** (детектированы только пиксели
фона, порог 50 px не пройден).

В отличие от B-001, здесь рендеринг в целом работает (планета, если есть в сцене — видна),
но конкретный объект не выдаёт пикселей.

### Хронология расследования

#### Этап 1: Исключение фрустум-каллинга

CDP-диагностика показала:
- `_activeMeshes.data` содержит все 6 частей самолёта
- `isInFrustum()` = `true` для всех частей
- `isVisible` = `true`, `isEnabled` = `true`
- Материал: `StandardMaterial` с `emissiveColor` = 0.85× hex, `emissivePower` = 2.0
- Свет: `DirectionalLight` + `HemisphericLight` присутствуют

Фрустум-каллинг исключён.

#### Этап 2: Проверка шейдеров и WebGL-состояния

Добавлен тестовый объект `testQuad` (2×2 `CreateGround`, зелёный `StandardMaterial`,
`emissiveIntensity = 10`, `backFaceCulling = false`, `renderingGroupId = 1`) —
тоже не виден.

WebGL-состояние проверено через CDP:
- `gl.getError()` → `NO_ERROR`
- `gl.isProgram(program)` → `true`
- `gl.getProgramParameter(program, LINK_STATUS)` → `true`
- `CURRENT_PROGRAM` → установлен
- `BLEND`, `DEPTH_TEST`, `CULL_FACE` → в норме
- Viewport: полный экран

Шейдер скомпилирован и залинкован. WebGL-пайплайн на первый взгляд работает.

#### Этап 3: Обнаружение UBO проблемы

Проверка шейдерных uniform-блоков через `gl.getUniformBlockIndex(program, "SceneUboObject")`:
- `blockIndex` = валидный (0 или 1)
- `gl.getActiveUniformBlockParameter(program, blockIndex, UNIFORM_BLOCK_DATA_SIZE)` → **0**

Scene UBO имел размер 0 байт — данные (viewProjection, view, projection, vEyePosition)
никогда не загружались в GPU. Шейдер читал нулевой viewProjection → все вершины коллапсировали
в clip space → фрагментный шейдер не запускался.

**Root cause:** Babylon.js вызывает `finalizeSceneUbo()` только в `fastSnapshotMode` (оптимизация
для частых скриншотов). По умолчанию `fastSnapshotMode = false`, поэтому Scene UBO
никогда не наполняется данными. В обычном режиме Babylon.js полагается на то, что UBO будет
заполнен при первом биндинге, но из-за бага в v9.5.2 этого не происходит.

#### Этап 4: Исправление

**Fix:** `engine.disableUniformBuffers = true` в конструкторе `SceneManager`.

Это заставляет Babylon.js компилировать шейдеры без UBO-блоков (`sceneUboType = 'noUbo'`),
используя plain `uniform mat4 viewProjection` вместо `layout(std140) uniform SceneUboObject`.
Обычные uniform-ы биндятся индивидуально через `gl.uniform*` и не страдают от проблемы
с незаполненным UBO-буфером.

Верификация после фикса:
- `numActiveUniformBlocks` = 0 (вместо 1)
- `sceneUboType` = `'noUbo'`
- `viewProjection` uniform → валидные значения (не identity)

#### Этап 5: Верификация через OpenCV

После фикса — скриншот через CDP, анализ через `debug-cycle.sh`:
- Plane-only: **2005 non-background pixels → CONTENT DETECTED**
- Diff plane-vs-quad: 118 px (0.01%) — testQuad edge-on, plane основной источник пикселей

Самолёт виден. Проблема решена.

### Истинная причина

Babylon.js v9.5.2 не вызывает `finalizeSceneUbo()` в нормальном режиме рендеринга.
Scene UBO (binding=1) создаётся, но остаётся пустым (размер 0 байт).
Шейдер читает нулевую `viewProjection` матрицу → все вершины попадают
в `clip = (0, 0, NaN, 0)` → фрагментный шейдер никогда не достигается.

Проблема не проявляется для `PBRMaterial` с environment map, потому что PBR использует
другой шейдерный путь с другими UBO.

### Применённые фиксы

| Файл | Строка | Изменение |
|------|--------|-----------|
| `src/scene/SceneManager.ts:21` | `this.engine.disableUniformBuffers = true` | Добавлено после создания Engine |

### Связанные изменения (не обязательные для фикса, но улучшают отладку)

| Файл | Изменение |
|------|-----------|
| `src/debug-main.ts:50-60` | Тестовый `testQuad` для верификации рендеринга |
| `src/scene/SceneManager.ts:20` | `preserveDrawingBuffer: true` для readPixels (оказался не нужен — OpenCV+CDP лучше) |
| `src/plane/PlaneVisual.ts` | `alwaysSelectAsActiveMesh = true` на всех частях (чтобы исключить frustum culling) |

### Методологические находки

1. **UBO debug сложен:** `gl.getActiveUniformBlockParameter(program, idx, UNIFORM_BLOCK_DATA_SIZE)`
   возвращает размер буфера. Нулевой размер — UBO не заполнен. Надо смотреть ДО того как делать
   выводы о матрицах.
2. **OpenCV-first протокол работает:** `Page.captureScreenshot` → `debug-cycle.sh` показал
   NO CONTENT до фикса и CONTENT DETECTED после. Без OpenCV ушло бы много времени на
   ручное сравнение скриншотов.
3. **CDP важнее readPixels:** попытки использовать `readPixels` для диагностики давали
   противоречивые результаты (разные буферы, разное состояние WebGL).
   `Page.captureScreenshot` показывает composited frame и всегда корректен.

### Верификация

- Chrome + SwiftShader на dev VM: самолёт виден (2005 px контента)
- OpenCV `analyze`: CONTENT DETECTED
- `_activeMeshes`: 6 частей plane + testQuad = 7 мешей
- `_renderId`: инкрементируется (рендер-луп работает)
- draw calls: выполняются

### Финальная верификация (2026-05-08, fix/rendering branch)

После устранения всех трёх причин — UBO, `_referencePoint`, направление камеры —
debug-сервер (`debug.html` → `debug-main.ts`) показывает самолёт:

- 40,706 не-фоновых пикселей (OpenCV `analyze`)
- `_activeMeshes`: 6 частей plane (все `"part"`)
- Plane group: `(0, 0, 8)`, rotation 25° вокруг Y, scale 1.5
- Камера: identity quaternion, FOV 70°, nearZ 0.001
- Освещение: DirectionalLight + HemisphericLight + emissivePower 5.0 на всех частях
- Reference box (зелёный, впоследствии убран) — 1×1×1 на `(0, 2, 5)`

### Подход к изоляции проблемы (методология debug-сервера)

Чтобы добраться до рендерящегося самолёта, потребовалось исключить ВСЕ переменные,
оставив только минимальную сцену:

1. **Отказ от ChaseCamera** — `_camOffset`-кватернион ChaseCamera даёт неправильное
   отображение осей камеры в body-frame самолёта. В debug-сцене камера установлена
   в identity quaternion вручную — она смотрит вдоль +Z (Babylon.js left-handed default).

2. **Отказ от FlightModel** — FlightModel спавнит самолёт на радиусе планеты (6373 ед.
   от центра), и `alignToSurface()` задирает нос. В debug-сцене PlaneVisual создаётся
   напрямую, группа позиционируется в `(0, 0, 8)` — ровно перед камерой.

3. **Промежуточная проверка testBox** — перед добавлением самолёта сцена проверялась
   с простым 4×4×4 зелёным эмиссивным боксом. Это подтвердило, что UBO fix и
   `_referencePoint` fix работают, и проблема не в WebGL-пайплайне.

4. **Замена PBRMaterial → StandardMaterial + emissive** — PBR требует сложного
   lighting-сетапа (environment map, IBL). StandardMaterial с `emissiveColor` и
   `emissivePower = 5.0` виден даже без PBR-освещения.

5. **`alwaysSelectAsActiveMesh = true`** — чтобы исключить frustum culling на время
   отладки.

**Ключевой принцип:** отладку начинать с ультра-минимальной сцены, которая гарантированно
рендерится (бокс), и затем по одному добавлять компоненты реальной сцены.

### Сводка всех root causes

| # | Root cause | Компонент | Fix |
|---|-----------|-----------|-----|
| 1 | UBO пустой (size=0) — `finalizeSceneUbo()` не вызывается | SceneManager | `engine.disableUniformBuffers = true` |
| 2 | `_referencePoint = (0,0,0)` → LookAt вырождается после floating origin | SceneManager | `_referencePoint = new Vector3(0, 0, 1000)` |
| 3 | ChaseCamera `_camOffset`: комментарий говорит «камера смотрит вдоль -Z», но FreeCamera в Babylon.js LH смотрит вдоль **+Z**. `q1 = RotationAxis((0,-1,0), π/2)` маппит `+Z → -X` (назад) вместо `+Z → +X` (вперёд) | ChaseCamera | `q1 = RotationAxis((0, 1, 0), π/2)` — маппит `+Z → +X` |

### Детали root cause #3 (_camOffset)

`ChaseCamera._camOffset` вычисляется как `q2 * q1` где:

- `q1 = RotationAxis((0, -1, 0), π/2)` — предполагалось: маппит camera -Z → body +X
- `q2 = RotationAxis((1, 0, 0), π/2)` — маппит camera +Y → body +Z

Но `FreeCamera` в Babylon.js (left-handed) с identity quaternion смотрит вдоль **+Z**, не -Z.
В результате `q1` маппил `+Z → -X` (назад по body-frame), и камера всегда смотрела
в противоположную от носа самолёта сторону.

**Fix:** `q1 = RotationAxis((0, 1, 0), π/2)` — маппит `+Z → +X`, камера смотрит вдоль носа.
Верификация: `node`-скрипт подтвердил `camera +Z → [1, 0, 0]`, `camera +Y → [0, 0, 1]`.

### Референсный debug-срез

Архивный снэпшот рабочего состояния сохранён в
[`docs/archives/2026-05-08-debug-plane-slice/`](archives/2026-05-08-debug-plane-slice/README.md).

Содержит: `SceneManager.ts`, `PlaneVisual.ts`, `debug-main.ts`, `archive-main.ts`,
`debug.html`, `style.css`, скриншот с видимым самолётом.

**Независимый хостинг:** срез сервится напрямую из директории архива, не требует
копирования в `src/`:
```
http://localhost:8080/docs/archives/2026-05-08-debug-plane-slice/debug.html
```
Верифицирован 2026-05-08: 6 active meshes, 13,927 px, OpenCV CONTENT DETECTED.

Используется для диффа при будущих регрессиях рендеринга.

---

## B-001: Чёрный экран — планета не рендерится

**Дата:** 2026-05-07
**Компонент:** `src/flight/FlightModel.ts`, `src/scene/SceneManager.ts`
**Severity:** critical (рендеринг полностью отсутствовал)
**Статус:** resolved

### Симптомы

При загрузке приложения в браузере — чёрный экран (clear color `#050510`).
HUD и controls-help (#controls-help) отображаются (это DOM-слой поверх WebGL).
В консоли ошибок нет. Меши создаются (391 шт.), но все зафрустум-каллены
(`_activeMeshes` = 0) либо камера смотрит мимо.

Пиксель в центре канваса при `readPixels` возвращает `(5, 5, 15)` — цвет очистки,
а не отрендеренный контент.

### Хронология расследования

#### Этап 1: Проверка мешей и сцены

CDP-диагностика показала:
- 391 меш создан, `absolutePosition` у всех `(0,0,0)` (нормально — вершины в геометрии)
- `worldGroup.position` = `(0,0,0)` — флоатинг ориджин не срабатывает
- `cam.position` = `(0,0,0)` — камера не двигается с места
- `cam.rotationQuaternion` = `(0,0,0,1)` — identity, камера смотрит вдоль +Z

**Ложный след:** `Page.reload` в CDP-скриптах убивает `requestAnimationFrame`
в фоновой вкладке, рендер-луп Babylon.js не запускается, коллбэки onUpdate
не выполняются. Все показатели — это состояние инициализации, а не рантайма.

#### Этап 2: Диагностика flight-модели

`FlightModel.alignToSurface()` производил мальформированный кватернион:
- `Quaternion = (0, 0, 0.573569, 0.819157)` с length = 0.707 (не единичный!)

**Root cause:** `Vector3.Cross(up, tangentFwd)` даёт левостороннюю систему
(det = -1). `FromRotationMatrixToRef` из такой матрицы извлекает кватернион
с половинной длиной. При нормализации теряется знак и ось.

**Fix:** `Cross(tangentFwd, up)` — правосторонняя система (det = +1).

**Fix 2:** Добавлен `this.quat.normalize()` после `FromRotationMatrixToRef`
(защита от накопления ошибок с плавающей точкой).

После фикса: `flight quat = (0, 0, 0.573569, 0.819157)` с length = 1.0.
Euler-углы: `(0, 0, 1.2217)` — roll 70°.

#### Этап 3: Диагностика камеры

Даже с правильным flight-кватернионом камера оставалась в `(0,0,0)` с identity.
Причина: **CDP Page.reload** — рендер-луп не работал, `ChaseCamera.update()`
не вызывался, `firstFrame` оставался `true`, камера не инициализировалась.

В уже работающей вкладке (без reload): `firstFrame = false`,
`cam_quat = (-0.15, -0.23, -0.55, 0.79)` — валидный не-identity кватернион.

#### Этап 4: _referencePoint

Даже когда камера получила правильный rotationQuaternion, `_getViewMatrix`
использует `_referencePoint` для вычисления `_currentTarget`:
```
_currentTarget = position + _transformedReferencePoint
```
где `_transformedReferencePoint` = `_referencePoint`, повёрнутый матрицей
камеры. По умолчанию `_referencePoint = (0,0,0)`, что после флоатинг-ориджина
(позиция камеры = 0) даёт `_currentTarget = (0,0,0)`, и `LookAtLH(0, 0, up)`
возвращает невалидную view-матрицу.

**Fix:** `(camera as any)._referencePoint = new Vector3(0, 0, 1000)` в
`SceneManager`. Конкретное значение неважно — главное, чтобы оно было
ненулевым.

### Истинные причины

1. **FlightModel.alignToSurface()** — перепутан порядок операндов в Cross,
   левосторонняя матрица → мальформированный кватернион.
2. **Camera._referencePoint = Zero** — после флоатинг-ориджина камера
   оказывается в центре сцены, а `_currentTarget` совпадает с позицией,
   LookAt вырождается.
3. **Отсутствие normalize()** после FromRotationMatrixToRef — экономия на
   защите от FP-ошибок.

### Применённые фиксы

| Файл | Строка | Изменение |
|------|--------|-----------|
| `src/flight/FlightModel.ts:141` | `Cross(tangentFwd, up)` | Было `Cross(up, tangentFwd)` |
| `src/flight/FlightModel.ts:149` | `this.quat.normalize()` | Добавлена нормализация |
| `src/scene/SceneManager.ts:34` | `_referencePoint = (0,0,1000)` | Добавлена инициализация |

### Методологическая проблема

Все CDP-скрипты использовали `Page.reload` для сброса страницы перед
диагностикой. Это некорректно: после reload вкладка переходит в фоновый
режим (в контексте CDP), `requestAnimationFrame` не срабатывает, и
Babylon.js render loop не запускается. Все показатели — это
`post-init, pre-render`.

**Правильный подход:** аттачиться к уже запущенной странице без reload:
```javascript
const sid = (await Target.attachToTarget(...)).sessionId;
// НЕ вызывать Page.reload!
// Ждать и делать Runtime.evaluate
```

### Верификация

При аттаче к уже работающей странице (без reload):
- `firstFrame: false` — ChaseCamera.execute отрабатывает
- `cam_quat: (-0.15, -0.23, -0.55, 0.79)` — не-identity
- `worldGroup: (-5993, -2182, -2)` — флоатинг ориджин работает
- FPS: 1.8 (фоновая вкладка, в активной будет 60)
- Скриншот 562 KB с содержимым планеты (57.7% пикселей отрендерено)
- Цвета: серые (скалы), зелёные (биомы низменностей), светло-серые (возвышенности)
- Biome coloring виден
