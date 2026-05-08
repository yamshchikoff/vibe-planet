# Visual Debugging Skill

Навык систематической отладки визуальных проблем в WebGL-приложениях.

## ⚠️ Первое действие при визуальной проблеме

**Не лезь в WebGL, не читай readPixels, не смотри на матрицы.**

1. Снять скриншот через CDP → `/tmp/debug-screenshot.png`
2. **Сразу прогнать через OpenCV** одной командой:

```bash
bash /tmp/debug-cycle.sh /tmp/debug-screenshot.png
```

Скрипт `debug-cycle.sh` делает `scp` на dev VM и запускает `analyze_bisect.py analyze`. Работает из любого места. Не требует помнить флаги, пути, или IP адрес dev VM.

Если нужно сравнить два скриншота:
```bash
bash /tmp/debug-cycle.sh /tmp/before.png /tmp/after.png
```

**CONTENT DETECTED** → объект виден, ищи проблему не в рендеринге.  
**NO CONTENT** → объект не рендерится, продолжай bisect.

`Page.captureScreenshot` — authoritative source of truth. `readPixels` в 50% случаев показывает не тот буфер.

**Почему единый скрипт, а не два шага:** практика показала, что ручной `scp ... && ssh ...` систематически забывается. Когда скриншот и анализ разнесены — анализ пропускается. Единая команда решает проблему.

## Принцип

Визуальная проблема — это когда объект есть в сцене (в мешах, в active meshes), но не виден на экране. Метод решения — **редукция сцены**: последовательное упрощение до минимально возможного набора элементов, при котором проблема воспроизводится, затем бисектом добавлять элементы обратно.

Основная сцена **не изменяется**. Для отладки создаётся отдельный entry point, который импортирует те же модули из `src/`, но собирает минимальную версию сцены.

## Изолированная дебажная среда

### Структура

Дебажная среда живёт в двух файлах, не затрагивающих основную сцену:

```
planet/
├── debug.html              ← HTML-шаблон, ссылается на src/debug-main.ts
├── src/
│   ├── main.ts             ← основная сцена (не трогать)
│   ├── debug-main.ts       ← минимальная сцена для отладки (создать)
│   ├── scene/
│   ├── plane/
│   ├── camera/
│   ├── flight/
│   └── ...
└── ...
```

### Запуск

```bash
# Основная сцена на 8080
npm run dev

# Дебажная сцена — через тот же Vite сервер:
# http://localhost:8080/debug.html
```

Никаких изменений `vite.config.ts`, `tsconfig.json` или `package.json` не требуется. Vite умеет сервить любые `.html` файлы из корня проекта.

### Создание минимальной сцены

`debug.html`:
```html
<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><title>Debug</title></head>
<body>
  <canvas id="app"></canvas>
  <script type="module" src="/src/debug-main.ts"></script>
</body>
</html>
```

`src/debug-main.ts` — минимальный entry point, собирается из готовых модулей:

```typescript
import './style.css';
import { SceneManager } from './scene/SceneManager';
import { FlightModel } from './flight/FlightModel';
import { PlaneVisual } from './plane/PlaneVisual';
import { ChaseCamera } from './camera/ChaseCamera';
import { FlightDebug } from './debug/FlightDebug';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';

const canvas = document.getElementById('app') as HTMLCanvasElement;
if (!canvas) throw new Error('Canvas not found');

// Scene
const scene = new SceneManager(canvas);
const worldGroup = scene.getWorldGroup();
const bjsScene = scene.getScene();
const cam = scene.getCamera();
cam.fov = 70 * Math.PI / 180;
cam.minZ = 0.001;

// Minimal light (только для того, чтобы PBRMaterial не был чёрным)
const light = new DirectionalLight('debugLight', new Vector3(0.5, -1, 0.5), bjsScene);
light.intensity = 1.0;
const hemi = new HemisphericLight('debugHemi', new Vector3(0, 1, 0), bjsScene);
hemi.intensity = 0.4;

// Flight — спавн в чистом небе
const flight = new FlightModel(6371, [0, 6375, 0]);
const controls = new FlightDebug(flight);

// Plane
const plane = new PlaneVisual(bjsScene);
plane.getMesh().parent = worldGroup;

// Camera
const chaseCamera = new ChaseCamera(cam, {
  offset: [-2, 0, 0.5],
  lerpSpeed: 0.3,
});

// Game loop
const _quat = new Quaternion();
scene.onUpdate((dt) => {
  const input = controls.getControls();
  flight.applyControls(input);
  flight.update(dt);

  const state = flight.getState();
  const [px, py, pz] = state.position;
  _quat.copyFrom(flight.getQuaternion());
  plane.update([px, py, pz], _quat);
  chaseCamera.update(new Vector3(px, py, pz), _quat, dt);
});

scene.start();
```

**Отличия от основной сцены:**
- Нет `LODPlanet` — ландшафт отсутствует
- Нет `Sun` — вместо него минимальные `DirectionalLight` + `HemisphericLight`
- Нет атмосферы
- Спавн в чистом небе (`[0, 6375, 0]`), а не над горой
- `FlightDebug` сразу в режиме `MANUAL` (управление клавишами)

### Просмотр скриншотов

Скриншоты сохранять в `/tmp/`, копировать в `public/` для просмотра:

```bash
cp /tmp/step-1.png /home/agent/planet/public/
# → http://localhost:8080/step-1.png
```

## Методология: редукция сцены (bisect)

### Шаг 1 — Минимальная сцена

Собрать entry point только из:
1. `SceneManager` — движок, камера, floating origin
2. `FlightModel` — состояние полёта (спавн в чистом небе)
3. `PlaneVisual` — 6 частей самолёта
4. `ChaseCamera` — следование за самолётом
5. Минимальный свет — `DirectionalLight` + `HemisphericLight`

### Шаг 2 — Добавление компонентов по одному

Порядок добавления (от минимального к полному):

| # | Компонент | Что проверяем |
|---|-----------|---------------|
| 1 | Базовая сцена (уже) | Плоскость видна на скриншоте |
| 2 | `Sun.ts` (освещение + диск) | Не гасит ли PBR-эмиссию |
| 3 | `LODPlanet` (ландшафт) | Не забивает ли z-buffer |
| 4 | Атмосфера | Не перекрывает ли |

На каждом шаге:
1. Добавить импорт и инстанцирование компонента в `debug-main.ts`
2. Перезагрузить `http://localhost:8080/debug.html`
3. Скриншот через CDP
4. Проверить визуально + пиксельный анализ

### Шаг 3 — Скриншот и пиксельный анализ

```javascript
// CDP: шаг N
await send('Page.bringToFront');
await new Promise(r => setTimeout(r, 3000));
const ss = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
fs.writeFileSync('/tmp/debug-step-N.png', Buffer.from(ss.result.data, 'base64'));
```

```python
# Пиксельный анализ
from PIL import Image
img = Image.open('/tmp/debug-step-N.png')
w, h = img.size
for y in range(0, h, 2):
    for x in range(0, w, 2):
        px = img.getpixel((x, y))[:3]
        if px != (5, 5, 15):  # clear color
            # Если на шаге N появились новые пиксели — порядок
            # Если на шаге N пиксели самолёта пропали — компонент сломал
            ...
```

## Инфраструктура отладки

### Три среды

| Среда | Назначение |
|-------|------------|
| **Host (fast loop)** `localhost:8080` | HMR, быстрая итерация кода |
| **Dev VM** `192.168.181.129` | Chrome + SwiftShader, скриншоты через CDP |
| **Deploy VM** `79.139.138.87:8080` | Production-сборка, финальная проверка |

### CDP (Chrome DevTools Protocol)

Chrome на dev VM слушает `localhost:9222` (remote debugging). Проброс на host:

```bash
ssh -f -N -L 9223:localhost:9222 claude@192.168.181.129
```

Запуск Chrome на dev VM:
```bash
ssh claude@192.168.181.129 "DISPLAY=:99 nohup google-chrome-stable --no-sandbox --disable-gpu --enable-unsafe-swiftshader --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-dev --new-window http://192.168.181.128:8080/debug.html &>/tmp/chrome.log & disown"
```

Обрати внимание: URL указывает на `debug.html`, а не на основную страницу.

**Важные ограничения CDP:**
- Не вызывать `Page.enable` / `Runtime.enable` повторно на уже открытой вкладке — сбрасывает контекст выполнения
- `_activeMeshes` в Babylon.js — `SmartArray`, элементы лежат в `.data[i]`, а не в `[i]`
- `requestAnimationFrame` заморожен на фоновых вкладках — перед `captureScreenshot` делать `Page.bringToFront`
- При `Page.reload` Chrome может исчерпать ресурсы (`ERR_INSUFFICIENT_RESOURCES`) после нескольких перезагрузок — очищать кэш через `Network.clearBrowserCache`
- Если вкладка открыта на другой странице, `Page.navigate` на нужный URL

### Шаблон CDP-скрипта

```javascript
import WebSocket from 'ws';
import http from 'http';
import fs from 'fs';

http.get('http://localhost:9223/json', (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const tabs = JSON.parse(data);
    const tab = tabs.find(t => t.title === 'Debug' && t.url.includes(':8080'));
    if (!tab) { console.log('Tab not found, trying Planet...'); /* fallback */ }
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    let id = 1;
    const pending = {};
    ws.on('message', raw => {
      const resp = JSON.parse(raw.toString());
      if (resp.id && pending[resp.id]) { pending[resp.id](resp); delete pending[resp.id]; }
    });
    function send(method, params) {
      return new Promise(resolve => { const msgId = id++; pending[msgId] = resolve; ws.send(JSON.stringify({ id: msgId, method, params })); });
    }
    ws.on('open', async () => {
      await send('Network.clearBrowserCache');
      await send('Page.reload', { ignoreCache: true });
      await new Promise(r => setTimeout(r, 15000));
      await send('Page.bringToFront');
      await new Promise(r => setTimeout(r, 3000));
      const r = await send('Runtime.evaluate', {
        expression: '(function() { var d = window.__debug; return d ? "ok ri=" + d.bjsScene._renderId : "no_debug"; })()',
        returnByValue: true,
      });
      console.log(r.result?.result?.value);
      const ss = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync('/tmp/debug-screenshot.png', Buffer.from(ss.result.data, 'base64'));
      console.log('Screenshot saved');
      ws.close();
    });
  });
});
```

Скрипты хранить в `/tmp/cdp-*.mjs`, запускать:
```bash
cd /tmp && NODE_PATH=/tmp/node_modules node cdp-debug-full.mjs && bash /tmp/debug-cycle.sh /tmp/debug-screenshot.png
```

**Важно:** каждый запуск CDP-скрипта завершается `debug-cycle.sh` — OpenCV-анализ происходит автоматически, не как отдельный шаг.

## Babylon.js: подводные камни

| Проблема | Симптом | Решение |
|----------|---------|---------|
| `_activeMeshes` — SmartArray | `act[i] === undefined` при длине > 0 | Использовать `act.data[i]` |
| rAF заморожен на фоне | renderId не растёт, скриншот пустой | `Page.bringToFront` перед capture |
| `ERR_INSUFFICIENT_RESOURCES` | Скрипты не грузятся после reload | `Network.clearBrowserCache` |
| PBRMaterial без env | Металлические части чёрные | Проверить emissive, или StandardMaterial |
| `Page.enable` повторно | Runtime контекст сбрасывается | Не вызывать на уже открытой вкладке |
| floating origin | bounding boxes не обновлены | Проверить `computeWorldMatrix(true)` |
| Vite не подхватил новый .html | 404 на debug.html | Перезапустить `npm run dev` |

## Автоматический анализ скриншотов через OpenCV

Для ускорения бисекта используется компьютерное зрение: автоматическое сравнение скриншотов соседних шагов и детекция новых объектов на сцене.

### Установка на Dev VM

OpenCV ставится через pip (требуется только на dev VM, где работает Chrome):

```bash
# Установка pip (если не установлен)
wget https://bootstrap.pypa.io/get-pip.py -O /tmp/get-pip.py
python3 /tmp/get-pip.py --user --break-system-packages

# Установка OpenCV
export PATH=$PATH:/home/claude/.local/bin
pip install opencv-python numpy --break-system-packages --user

# Проверка
python3 -c "import cv2; print(cv2.__version__)"
```

**Важно:** на Ubuntu 26.04 с Python 3.14 `ensurepip` отсутствует, `apt install python3-pip` требует sudo с паролем. `--break-system-packages` необходим из-за PEP 668.

### Единый скрипт debug-cycle.sh

Скрипт `/tmp/debug-cycle.sh` на host — единая точка входа для визуальной отладки. Принимает 1 или 2 скриншота, копирует на dev VM, запускает OpenCV-анализ, выводит вердикт.

```bash
# Содержимое /tmp/debug-cycle.sh (хост):
#!/bin/bash
# Единая точка входа для визуальной отладки.
# Хранится на хосте, скрипты анализа — тоже на хосте.
# При запуске копирует скриншот и скрипт анализа на dev VM, запускает OpenCV.
set -euo pipefail

ANALYZER="/tmp/analyze_bisect.py"
DEVM="claude@192.168.181.129"
SCREENSHOT="${1:-/tmp/debug-screenshot.png}"
SCREENSHOT2="${2:-}"

echo "=== OpenCV Analysis ==="

# Авто-копирование скрипта анализа на dev VM
scp -q "$ANALYZER" "$DEVM":/tmp/analyze_bisect.py

# Скриншот на dev VM
scp -q "$SCREENSHOT" "$DEVM":/tmp/debug-input.png

if [ -n "$SCREENSHOT2" ]; then
    scp -q "$SCREENSHOT2" "$DEVM":/tmp/debug-input-2.png
    ssh "$DEVM" "python3 /tmp/analyze_bisect.py analyze /tmp/debug-input.png && echo '---' && python3 /tmp/analyze_bisect.py compare /tmp/debug-input.png /tmp/debug-input-2.png"
else
    ssh "$DEVM" "python3 /tmp/analyze_bisect.py analyze /tmp/debug-input.png"
fi

echo "=== Done ==="
```

Использование:
```bash
# Один скриншот — детекция контента
bash /tmp/debug-cycle.sh /tmp/debug-screenshot.png

# Два скриншота — сравнение (diff)
bash /tmp/debug-cycle.sh /tmp/step-0.png /tmp/step-1.png
```

### Скрипт анализа на dev VM

**Артефакты отладки хранятся на хосте** (`/tmp/`), не на dev VM. Хост переживает перезапуски сессий, dev VM — нет.

Скрипт `/tmp/analyze_bisect.py` на хосте. На dev VM копируется при каждом запуске:

```bash
# Копирование с host на dev VM (однократно после создания/обновления скрипта)
scp /tmp/analyze_bisect.py claude@192.168.181.129:/tmp/analyze_bisect.py
```

Сам `debug-cycle.sh` тоже можно дополнить авто-копированием скрипта перед запуском, чтобы не помнить об этом шаге.

Поддерживает три режима:

**1. `analyze` — детекция объектов на скриншоте:**
```bash
python3 /tmp/analyze_bisect.py analyze /tmp/step-0.png
# → Non-background pixels: 10201
# → RESULT: CONTENT DETECTED — plane or other object likely visible
```

Сравнивает каждый пиксель с известным clear color `(5, 5, 15)`, отбрасывает шум морфологическим opening, выносит вердикт.

**2. `compare` — разница между двумя скриншотами:**
```bash
python3 /tmp/analyze_bisect.py compare /tmp/step-0.png /tmp/step-1.png
# → Changed pixels: 10201/921600 (1.11%)
# → RESULT: SIGNIFICANT CHANGE — new visual element appeared
```

Сохраняет diff-маску в `/tmp/compare_diff.png` для визуальной инспекции.

**3. `batch` — пакетный анализ директории:**
```bash
python3 /tmp/analyze_bisect.py batch /tmp/bisect/
```

Сканирует все файлы `step-*.png`, для каждого выводит детекцию и diff от предыдущего шага — полная картина бисекта одной командой.

### Алгоритм

```
Скриншот → absdiff от clear_color → threshold 20 → morph opening(3×3) → countNonZero
                                                                    ↓
                                              > 50 px → "CONTENT DETECTED"
                                              ≤ 50 px → "NO CONTENT"
```

Порог в 50 пикселей отсекает шум сжатия и артефакты рендеринга фона.

### Воркфлоу бисекта с OpenCV

1. Снять скриншот шага N (через CDP): `/tmp/bisect/step-N.png`
2. Запустить анализ: `python3 /tmp/analyze_bisect.py batch /tmp/bisect/`
3. Если шаг N показывает "CONTENT DETECTED" → объект появился, всё в порядке
4. Если шаг N показывает "NO CONTENT" после того, как на шаге N-1 был "CONTENT DETECTED" → компонент, добавленный на шаге N, сломал видимость
5. Если ни на одном шаге нет детекции → проблема в базовом рендеринге (материал, свет, камера)

## Протокол отладки чанков (без камеры и зрения)

Чанки планеты — это чистая математика: UV → направление → сфера → высота.
Их корректность проверяется **инвариантами на сырых данных вершин**, без скриншотов,
без камеры, без визуального осмотра.

### Принцип

Позиция каждой вершины чанка определяется только четырьмя параметрами:
`(faceIdx, depth, tx, ty)` + `(R, heightAmp, chunkResolution)`. Камера не участвует.
Поэтому:

1. **Не надо смотреть на скриншот**, чтобы узнать, правильный ли чанк
2. **Не надо знать положение камеры**, чтобы проверить геометрию чанка
3. **Не надо лететь к полюсу**, чтобы узнать, есть ли там чанки — просто посчитай их

### Инварианты (I1–I5)

| # | Инвариант | Проверка |
|---|-----------|----------|
| I1 | **Радиальная дистанция:** каждая вершина ∈ [R, R + heightAmp] от центра (0,0,0) | `sqrt(x²+y²+z²)` |
| I2 | **Количество вершин:** ровно `(res+1)²` | `pos.length / 3 === 289` |
| I3 | **Длина нормали:** все нормали единичные | `abs(|n| - 1) < 1e-4` |
| I4 | **Знак оси грани:** вершины face 0 (+X) все имеют x > 0, face 3 (-Y) все y < 0 и т.д. | проверка знака |
| I5 | **Стыки чанков:** вершины на общей границе совпадают по x,y,z (не только высота) | diff max < 0.01 |

### Протокол (вместо визуального осмотра)

При подозрении на missing chunk или дыру в планете:

**Шаг 1 — Аудит face coverage:**
```
Запрос: LODPlanet.cache — группировка по faceIdx
Ожидание: все 6 граней имеют > 0 чанков
Реальность: если face 3 (-Y) = 0 чанков — проблема в culling'e или traversal'e
```

**Шаг 2 — Аудит покрытия чанков:**
Для каждой грани `fi` и каждого уровня `d`, вычислить ожидаемое количество чанков
`4^d` и сравнить с фактическим. Пропущенные (tx, ty) — дыры.

**Шаг 3 — Проверка инвариантов (I1–I5) через CDP:**
```javascript
// Все 5 инвариантов за один evaluate
const r = await send('Runtime.evaluate', {
  expression: `(() => {
    const meshes = debug.bjsScene.meshes
      .filter(m => m.name && m.name.startsWith('chunk-'));
    // I1: radial distance
    // I2: vertex count
    // ... все проверки
  })()`
});
```

**Шаг 4 — Вывод:**
- Если I1–I5 проходят, но чанков на грани 0 → проблема **в traversal (LOD-алгоритм)**
- Если I1–I5 не проходят → проблема **в generateChunk (математика генерации)**
- Если все грани покрыты и инварианты проходят → проблема **не в геометрии планеты**

### Пример: face coverage audit

Из CDP получаем распределение:
```
face 0 (+X): 574 чанков, depths 3-11  ← норма (камера рядом)
face 1 (-X):   0 чанков                ← норма (обратная сторона)
face 2 (+Y):  52 чанка,  depths 2-4   ←可疑 (мало)
face 3 (-Y):   0 чанков                ← !!! ЭТА ГРАНЬ ПОЛНОСТЬЮ ПРОПУЩЕНА
face 4 (+Z):  31 чанк,   depths 2-3   ← норма (далеко)
face 5 (-Z):  31 чанк,   depths 2-3   ← норма (далеко)
```

Face 3 (-Y) c 0 чанков — однозначная аномалия. Без скриншота, без камеры,
просто по данным. Причина: face culling `dot < -0.2` отсекает грань из-за
положения камеры (Y-компонента позиции > 0).

Это НЕ бага генерации чанков — это бага LOD-алгоритма, который доверяет
culling'у граней по одному направлению. Для планеты (огромный объект,
видимый с любого ракурса) culling граней должен быть значительно мягче
или отсутствовать.

### Инвариант I6 — Face Coverage (новый)

Каждая из 6 граней кубической сферы должна иметь ненулевое количество
активных чанков в любой момент времени. Ноль чанков на грани = бага.

Для `update()`: face culling (`dot < -0.2`) не должен полностью отсекать
грань, если хотя бы часть её видна (dot > -0.7 или вообще не cull лица
по нормали, а cull по расстоянию до углов грани).

## Быстрые команды

```bash
# Проброс порта CDP
ssh -f -N -L 9223:localhost:9222 claude@192.168.181.129

# Запуск Chrome на dev VM (дебажная страница)
ssh claude@192.168.181.129 "DISPLAY=:99 nohup google-chrome-stable --no-sandbox --disable-gpu --enable-unsafe-swiftshader --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-dev --new-window http://192.168.181.128:8080/debug.html &>/tmp/chrome.log & disown"

# Скриншот
cd /tmp && NODE_PATH=/tmp/node_modules node cdp-script.mjs

# Просмотр скриншота
cp /tmp/debug-screenshot.png /home/agent/planet/public/
# → http://localhost:8080/debug-screenshot.png

# Пулл скриншота с dev VM
scp claude@192.168.181.129:/tmp/screenshot.png /tmp/

# Очистка кэша Chrome
ssh claude@192.168.181.129 "rm -rf /tmp/chrome-dev"
```
