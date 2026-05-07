# Planet

Procedural planet generator + flight simulator. Браузерное приложение на Babylon.js.

## Development Protocol (строгий)

Любое изменение проходит ровно 3 фазы, в строгом порядке:

### Фаза 1 — Документация
- Обновить `docs/` или написать спецификацию того, что будет сделано
- Документация — живой артефакт: она всегда отражает актуальное состояние

### Фаза 2 — Тесты
- Написать тесты (`.test.ts`) под документированное поведение
- Убедиться, что тесты падают (RED)
- **Не реализовывать фичу до написания теста**

### Фаза 3 — Реализация
- Написать код, проходящий тесты (GREEN)
- Рефакторить только если тесты зелёные

### Commits (строгие)

Каждый коммит содержит изменения **только одной категории**:

```
1. docs: ...     — только docs/ и CLAUDE.md
2. test: ...     — только *.test.ts
3. feat/fix: ... — только реализация (не тесты, не docs)
```

Категории в одном коммите не смешиваются. После коммита реализации — перечитать `docs/`, проверить консистентность с кодом и тестами, если нужно — коммит `docs:` отдельно.

После цикла — `npm run dev` для визуальной проверки.

### Пример цикла

```
Документация:  docs: add atmosphere module spec
                         ↓
Тесты:         test: atmosphere shader and cloud layer
                         ↓
Реализация:    feat: atmosphere scattering and cloud layer
                         ↓
Синк docs:     (если docs отстали от реализации)
                         ↓
Визуально:     npm run dev → проверить в браузере
```

## Project Rules

- TypeScript throughout
- Vitest для тестов
- Никакого клиент-серверного API для игровых механик — всё в браузере

## Commands

- `npm test` — прогнать тесты
- `npm test -- --watch` — вотчер
- `npm run build` — production-сборка

## Debug Infrastructure

У нас **три среды** разработки и отладки:

| Среда | Команда | Назначение |
|-------|---------|------------|
| **Host (fast loop)** | `npm run dev` → http://localhost:8080/ | Активная разработка, HMR, 95% времени |
| **Dev VM** (Ubuntu Desktop) | Браузер на 192.168.181.129 | Визуальная проверка, скриншоты, console errors |
| **Deploy VM** (QEMU Alpine) | `npm run build` + deploy | Финальная проверка перед коммитом, детерминизм |

### Host — быстрый цикл

```bash
npm run dev
# → http://localhost:8080/ (Vite dev server, HMR)
```

Для быстрой итерации: меняешь код → HMR обновляет страницу.

### Dev VM (Ubuntu Desktop 26.04)

Изолированная VMware虚拟机 с Ubuntu Desktop и Chrome для визуальной отладки.
Используется для скриншотов и проверки console errors в реальном браузере.

**Доступ:**
- **IP**: 192.168.181.129, пользователь: claude
- **SSH**: `ssh claude@192.168.181.129` (ключ, пароль не используется)
- **Пароль sudo**: хранится отдельно, в git не попадает

**Chrome remote debugging (для скриншотов через CDP):**

С Chrome на dev VM можно взаимодействовать программно через Chrome DevTools Protocol.
Это позволяет делать скриншоты и инспектировать JS-состояние без GUI.

```bash
# На dev VM — запустить Xvfb (если не запущен):
ssh claude@192.168.181.129 'pgrep -a Xvfb || (Xvfb :99 -screen 0 1920x1080x24 &>/dev/null & disown)'

# На dev VM — запустить Chrome с remote debugging:
ssh claude@192.168.181.129 "DISPLAY=:99 nohup google-chrome-stable --no-sandbox --disable-gpu --enable-unsafe-swiftshader --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-dev --new-window http://192.168.181.128:8080/ &>/tmp/chrome.log & disown"

# На host — forward порта:
ssh -f -N -L 9222:localhost:9222 claude@192.168.181.129

# Screenshot + console через CDP:
curl -s http://localhost:9222/json  # список страниц
# Для capture:
#   cd /tmp && npm init -y && npm install ws
#   node -e '...WebSocket...Page.captureScreenshot...Page.navigate...Runtime.evaluate...'
```

**CDP workflow:**
1. `Target.attachToTarget` — привязаться к странице (flatten: true)
2. `Page.navigate` — загрузить URL
3. `Runtime.evaluate` — выполнить JS, получить состояние
4. `Page.captureScreenshot` — PNG base64

**На host установлено:** Node.js, npm, ws-модуль в /tmp/node_modules/ws

### Deploy VM (QEMU Alpine, TCG full emulation)

Для детерминизма и герметичности. Приложение собирается в production-бандл и подаётся через HTTP-сервер внутри Alpine Linux VM.

**ВНИМАНИЕ**: Deploy VM используется только для финальной проверки production-сборки.
Не используется для активной разработки.

```bash
# 1. Build
npm run build

# 2. Boot VM (ждём 60–80 с)
./scripts/boot-vm.sh

# 3. Package + upload + serve
tar czf /tmp/planet.tgz dist/ && \
  scp -P 2222 /tmp/planet.tgz root@localhost:/opt/ && \
  ssh -f root@localhost -p 2222 "nohup python3 -m http.server 8080 --directory /opt/dist/ > /dev/null 2>&1"

# 4. Открыть: http://79.139.138.87:8080/
```

### Портовая схема

| Назначение | Адрес |
|-----------|-------|
| Vite dev server (host) | `http://localhost:8080/` |
| Dev VM (Chrome) | `http://192.168.181.128:8080/` |
| Deploy VM (QEMU, production) | `http://79.139.138.87:8080/` |
| SSH в Deploy VM | `ssh root@localhost -p 2222` |

## Module Map

```
src/scene/      — SceneManager (Babylon.js setup, render loop)
src/planet/     — LODPlanet (quadtree terrain, chunked LOD)
src/flight/     — FlightModel (physics, state)
src/controls/   — KeyboardControls, GamepadControls (input)
src/atmosphere/ — Sun.ts (day/night cycle, PBR lighting)
src/plane/      — PlaneVisual (aircraft mesh, PBR materials)
src/camera/     — ChaseCamera (smooth follow, body-frame orientation)
```

## Skill Development: Visual Debugging

Навык визуальной отладки WebGL-приложений развивается в `docs/skills/visual-debugging.md`.

Метод: редукция сцены до минимального набора элементов, бинарный поиск проблемного компонента, скриншоты через CDP на каждом шаге.

При любой визуальной проблеме (объект в сцене, но не виден) — следовать протоколу из skill-файла перед изменением кода.
