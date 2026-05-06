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

## Dev Server (всегда в QEMU VM)

**Важно:** "поднять сервер", "запустить сервер", "посмотреть в браузере" — всегда означает:
1. Забилдить проект
2. Запаковать в tarball
3. Запустить QEMU VM
4. Закинуть tarball внутрь VM через SSH и запустить HTTP сервер
5. Приложение доступно на `http://79.139.138.87:8080/`

### Полный цикл

```bash
# 1. Build
npm run build

# 2. Package tarball
tar czf /home/agent/qemu-vm/planet.tgz dist/

# 3. Boot VM (ждём 60-80с)
./scripts/boot-vm.sh

# 4. В другом терминале: залить tarball и запустить сервер
ssh root@localhost -p 2222 "cd /opt && tar xzf planet.tgz && nohup python3 -m http.server 8080 --directory dist/ &"

# 5. Открыть: http://79.139.138.87:8080/
```

### После изменений (быстрый редеплой)

```bash
npm run build && tar czf /home/agent/qemu-vm/planet.tgz dist/ && \
  scp -P 2222 /home/agent/qemu-vm/planet.tgz root@localhost:/opt/ && \
  ssh root@localhost -p 2222 "cd /opt && tar xzf planet.tgz && pkill -f http.server; nohup python3 -m http.server 8080 --directory dist/ &"
```

### Серия и порты

| Назначение | Адрес |
|-----------|-------|
| Приложение | `http://79.139.138.87:8080/` |
| SSH в VM | `ssh root@localhost -p 2222` |
| Внутренний IP хоста | `192.168.181.128` |
| Локальный хост | `localhost:8080` (проброшен в VM) |

## Module Map

```
src/scene/      — SceneManager (Three.js setup, render loop)
src/planet/     — PlanetGenerator (procedural mesh, shaders)
src/flight/     — FlightModel (physics, state)
src/controls/   — KeyboardControls, GamepadControls (input)
src/atmosphere/ — sky shader, clouds
```
