# Planet

Procedural planet generator + flight simulator. Браузерное приложение на Three.js.

## Development Rules

- **Documentation-Driven**: before writing code, write/update docs
- **TDD**: tests first, implementation second. Никакой код без теста.
- TypeScript throughout
- Vitest для тестов
- Никакого клиент-серверного API для игровых механик — всё в браузере

## Workflow

1. docs/ — архитектура и спецификации
2. *.test.ts — тесты
3. реализация
4. `npm run dev` — ручная проверка

## Commits

Каждый модуль — отдельный коммит. Порядок коммитов:
1. docs + CLAUDE.md
2. tests для модуля
3. реализация модуля
4. интеграция (main.ts, index.html)

Коммиты узкие, атомарные. Без "и ещё кое-что заодно".

## Documentation Sync

После каждого коммита реализаций:
1. Обновить документацию (архитектуру, спецификации, планы) под текущее состояние кода
2. Проверить консистентность: документация не противоречит коду и тестам
3. Если документация менялась — закоммитить отдельно, с сообщением docs: ...

Документация — живой артефакт, она всегда отражает актуальное состояние проекта.

## Commands

- `npm run dev` — запустить dev-сервер
- `npm test` — прогнать тесты
- `npm test -- --watch` — вотчер

## Module Map

```
src/scene/      — SceneManager (Three.js setup, render loop)
src/planet/     — PlanetGenerator (procedural mesh, shaders)
src/flight/     — FlightModel (physics, state)
src/controls/   — KeyboardControls, GamepadControls (input)
src/atmosphere/ — sky shader, clouds
```
