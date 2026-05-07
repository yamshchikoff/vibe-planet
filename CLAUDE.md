# Planet

Procedural planet generator + flight simulator. Браузерное приложение на Three.js.

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

## Debug Loops

У нас **два цикла отладки**: быстрый (на хосте) и полный (в QEMU VM).

| Цикл | Команда | Время | Когда использовать |
|------|---------|-------|-------------------|
| **Быстрый** | `npm run dev` | ~1 с | Во время активной разработки, для быстрой итерации кода |
| **Полный** | build → QEMU → deploy | ~90 с | Финальная проверка перед коммитом; при изменениях в конфиге сборки, путях, зависимостях; когда нужно гарантировать детерминизм и герметичность |

### Быстрый цикл (host)

```bash
npm run dev
# → http://localhost:8080/ (Vite dev server на хосте, HMR)
```

Для быстрой итерации: меняешь код → HMR обновляет страницу. **Не гарантирует** детерминизма — среда хоста может отличаться от VM. Подходит для 95% разработки.

### Полный цикл (QEMU VM)

Для детерминизма и герметичности. Приложение собирается в production-бандл и подаётся через HTTP-сервер внутри Alpine Linux VM (TCG full emulation, без KVM).

```bash
# 1. Build
npm run build

# 2. Boot VM (ждём 60–80 с)
./scripts/boot-vm.sh

# 3. Package + upload + serve (в одну строку)
tar czf /tmp/planet.tgz dist/ && \
  scp -P 2222 /tmp/planet.tgz root@localhost:/opt/ && \
  ssh -f root@localhost -p 2222 "nohup python3 -m http.server 8080 --directory /opt/dist/ > /dev/null 2>&1"

# 4. Открыть: http://79.139.138.87:8080/
```

### Быстрый редеплой в VM (после изменений, VM уже запущена)

```bash
npm run build && tar czf /tmp/planet.tgz dist/ && \
  scp -P 2222 /tmp/planet.tgz root@localhost:/opt/ && \
  ssh -f root@localhost -p 2222 "nohup python3 -m http.server 8080 --directory /opt/dist/ > /dev/null 2>&1"
```

### Серия и порты

| Назначение | Адрес |
|-----------|-------|
| Приложение (host, fast loop) | `http://localhost:8080/` |
| Приложение (VM, full loop) | `http://79.139.138.87:8080/` |
| SSH в VM | `ssh root@localhost -p 2222` |
| Локальный хост для проброса | `localhost:8080` (занят VM в полном цикле) |

## Module Map

```
src/scene/      — SceneManager (Three.js setup, render loop)
src/planet/     — PlanetGenerator (procedural mesh, shaders)
src/flight/     — FlightModel (physics, state)
src/controls/   — KeyboardControls, GamepadControls (input)
src/atmosphere/ — sky shader, clouds
```
