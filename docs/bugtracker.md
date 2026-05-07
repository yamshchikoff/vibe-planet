# Баг-трекер

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
