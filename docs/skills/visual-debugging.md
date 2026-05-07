# Visual Debugging Skill

Навык систематической отладки визуальных проблем в WebGL-приложениях.

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
cd /tmp && NODE_PATH=/tmp/node_modules node cdp-script.mjs
```

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
