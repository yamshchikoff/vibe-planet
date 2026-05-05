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

- `npm run dev` — запустить dev-сервер
- `npm test` — прогнать тесты
- `npm test -- --watch` — вотчер
- `npm run build` — production-сборка

## Dev Server

Сервер поднимается на `0.0.0.0:8080`:
- Внешний IP: `79.139.138.87`
- Внутренний IP: `192.168.181.128`
- URL: `http://79.139.138.87:8080/`

## Module Map

```
src/scene/      — SceneManager (Three.js setup, render loop)
src/planet/     — PlanetGenerator (procedural mesh, shaders)
src/flight/     — FlightModel (physics, state)
src/controls/   — KeyboardControls, GamepadControls (input)
src/atmosphere/ — sky shader, clouds
```
