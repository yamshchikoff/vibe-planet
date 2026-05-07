# Visual Debugging Skill

Навык систематической отладки визуальных проблем в WebGL-приложениях.

## Принцип

Визуальная проблема — это когда объект есть в сцене (в мешах, в active meshes), но не виден на экране. Метод решения — **редукция сцены**: последовательное упрощение до минимально возможного набора элементов, при котором проблема воспроизводится, затем бисектом добавлять элементы обратно.

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

Работа с CDP через Node.js (модуль `ws` в `/tmp/node_modules/ws`):

```bash
cd /tmp && NODE_PATH=/tmp/node_modules node --input-type=module -e '
import WebSocket from "ws";
import http from "http";

http.get("http://localhost:9223/json", (res) => {
  let data = "";
  res.on("data", c => data += c);
  res.on("end", () => {
    const tabs = JSON.parse(data);
    // Ищем вкладку с нашим приложением
    const tab = tabs.find(t => t.title === "Planet" && t.url.includes(":8080"));
    if (!tab) process.exit(1);
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    let id = 1;
    const pending = {};
    ws.on("message", raw => {
      const resp = JSON.parse(raw.toString());
      if (resp.id && pending[resp.id]) { pending[resp.id](resp); delete pending[resp.id]; }
    });
    function send(method, params) {
      return new Promise(resolve => { const msgId = id++; pending[msgId] = resolve; ws.send(JSON.stringify({ id: msgId, method, params })); });
    }
    ws.on("open", async () => {
      // НЕ вызывать Page.enable / Runtime.enable повторно —
      // это сбрасывает контекст выполнения на уже подключенной вкладке
      const r = await send("Runtime.evaluate", {
        expression: "window.__debug ? JSON.stringify({renderId: window.__debug.bjsScene._renderId}) : \"no_debug\"",
        returnByValue: true,
      });
      console.log(r.result?.result?.value);
      ws.close();
    });
  });
});
'
```

**Важные ограничения CDP:**
- Не вызывать `Page.enable` / `Runtime.enable` если они уже были вызваны ранее на этой вкладке — сбрасывает контекст
- `_activeMeshes` в Babylon.js — `SmartArray`, элементы лежат в `.data[i]`, а не в `[i]`
- `requestAnimationFrame` заморожен на фоновых вкладках — перед `captureScreenshot` делать `Page.bringToFront`
- При `Page.reload` Chrome может исчерпать ресурсы (`ERR_INSUFFICIENT_RESOURCES`) после нескольких перезагрузок — очищать кэш через `Network.clearBrowserCache`

### Шаблон CDP-скрипта

Скрипты хранить в `/tmp/cdp-*.mjs`, запускать:
```bash
cd /tmp && NODE_PATH=/tmp/node_modules node cdp-script.mjs
```

Если нужно перезагрузить страницу, перед этим очистить кэш:
```javascript
await send('Network.clearBrowserCache');
await send('Page.reload', { ignoreCache: true });
```

## Методология: редукция сцены

### Шаг 1 — Минимальная сцена

Создать минимальную версию `main.ts` без планеты, солнца, атмосферы. Только `SceneManager` + `FlightModel` + `PlaneVisual` + `ChaseCamera`.

```typescript
// Минимальный entry point для отладки plane
import { SceneManager } from './scene/SceneManager';
import { FlightModel } from './flight/FlightModel';
import { PlaneVisual } from './plane/PlaneVisual';
import { ChaseCamera } from './camera/ChaseCamera';
import { FlightDebug } from './debug/FlightDebug';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const scene = new SceneManager(canvas);
const worldGroup = scene.getWorldGroup();
const bjsScene = scene.getScene();
const cam = scene.getCamera();

const flight = new FlightModel(6371, [0, 6375, 0]); // спавн в чистом небе
const debug = new FlightDebug(flight);
const plane = new PlaneVisual(bjsScene);
plane.getMesh().parent = worldGroup;

const chaseCamera = new ChaseCamera(cam, { offset: [-2, 0, 0.5], lerpSpeed: 0.3 });
scene.onUpdate((dt) => {
  const input = debug.getControls();
  flight.applyControls(input);
  flight.update(dt);
  const state = flight.getState();
  const quat = flight.getQuaternion();
  plane.update(state.position, quat);
  chaseCamera.update(new Vector3(state.position[0], state.position[1], state.position[2]), quat, dt);
});
scene.start();
```

Способы создания минимальной сцены:
1. **Отдельный entry point** — `src/debug-main.ts` в Vite config
2. **Флаг** — `localStorage` или query param, отключающий модули
3. **Замена файла** — временно перезаписать `src/main.ts`

Рекомендуется способ 1: отдельный entry point. Vite конфиг:
```typescript
// vite.config.ts
export default defineConfig({
  build: { rollupOptions: { input: { main: 'index.html', debug: 'debug.html' } } },
});
```

### Шаг 2 — Бинарный поиск (bisect)

1. Запустить минимальную сцену — убедиться что plane виден
2. Добавить один компонент (только Sun, или только LODPlanet, или только атмосферу)
3. Проверить, сломалось ли
4. Если сломалось — проблема в добавленном компоненте или его взаимодействии
5. Если не сломалось — добавить следующий компонент

Порядок добавления (от минимального к полному):
1. SceneManager (голый) + ChaseCamera + PlaneVisual
2. + FlightModel (движение)
3. + Sun (освещение)
4. + LODPlanet (ландшафт)
5. + Atmosphere (атмосфера)

### Шаг 3 — Скриншот на каждом шаге

На каждом шаге бисекта — скриншот через CDP. Сравнивать визуально.

```javascript
// В CDP-скрипте:
await send('Page.bringToFront');
await new Promise(r => setTimeout(r, 3000)); // ждём rAF
const ss = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
fs.writeFileSync('/tmp/debug-step-N.png', Buffer.from(ss.result.data, 'base64'));
```

### Шаг 4 — Анализ пикселей

Если объект числится в `_activeMeshes` но не виден — просканировать скриншот:

```python
from PIL import Image
img = Image.open('/tmp/screenshot.png')
w, h = img.size
# Все не-fon пиксели
non_bg = {}
for y in range(0, h, 2):
    for x in range(0, w, 2):
        px = img.getpixel((x, y))[:3]
        if px != (5, 5, 15):  # clear color
            non_bg[px] = non_bg.get(px, 0) + 1
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

## Быстрые команды

```bash
# Проброс порта CDP
ssh -f -N -L 9223:localhost:9222 claude@192.168.181.129

# Скриншот
cd /tmp && NODE_PATH=/tmp/node_modules node cdp-screenshot.mjs

# Просмотр скриншота (через Vite dev server)
cp /tmp/screenshot.png /home/agent/planet/public/
# → http://localhost:8080/screenshot.png

# Пулл скриншота с dev VM
scp claude@192.168.181.129:/tmp/screenshot.png /tmp/

# Запуск Chrome на dev VM
ssh claude@192.168.181.129 "DISPLAY=:99 nohup google-chrome-stable --no-sandbox --disable-gpu --enable-unsafe-swiftshader --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-dev --new-window http://192.168.181.128:8080/ &>/tmp/chrome.log & disown"

# Очистка кэша Chrome
ssh claude@192.168.181.129 "rm -rf /tmp/chrome-dev"
```
