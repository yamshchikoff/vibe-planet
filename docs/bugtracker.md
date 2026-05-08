# Баг-трекер

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
| 3 | ChaseCamera `_camOffset` даёт неправильную ориентацию камеры | ChaseCamera | В debug-сцене не используется; в production требует пересчёта |

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
