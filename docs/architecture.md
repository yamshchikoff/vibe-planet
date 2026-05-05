# Planet — Procedural Planet Generator & Flight Simulator

## Vision

Браузерное приложение, генерирующее процедурную планету с возможностью облетать её на самолёте. Весь рендеринг и игровая логика — на клиенте. Веб-сервер нужен только для раздачи статики.

## Development Approach

Разработка управляется документацией и тестами (Documentation-Driven & Test-Driven Development).

**Порядок работ:**
1. Документация (архитектура, спецификации модулей)
2. Тесты (модульные, интеграционные)
3. Реализация, проходящая тесты
4. Визуальная/ручная проверка в браузере

**Правила:**
- Ни одна фича не реализуется без теста
- Тест падает → имплементация
- Тест проходит → рефакторинг/следующая фича
- Каждый модуль — отдельный атомарный коммит
- После коммита реализации — обновить документацию, проверить на консистентность с кодом и тестами, закоммитить отдельно

## Technology Stack

| Компонент | Технология | Обоснование |
|-----------|-----------|-------------|
| 3D-движок | Three.js | Де-факто стандарт для WebGL |
| Язык | TypeScript | Типизация, автодополнение |
| Сборка | Vite | Быстрая dev-сборка, HMR |
| Тесты | Vitest + jsdom | Совместимость с Vite, окружение DOM |
| Сервер | Vite dev server / static | Нет API, только статика |
| Шум | Value noise FBM (CPU) | Процедурная генерация рельефа |

## Architecture Overview

```
┌─────────────────────────────────────────┐
│              index.html                  │
│  ┌────────────────────────────────────┐  │
│  │           main.ts                   │  │
│  │  ┌──────────┐  ┌────────────────┐  │  │
│  │  │  Scene    │  │  Planet        │  │  │
│  │  │  Manager  │──│  Generator     │  │  │
│  │  └──────────┘  └────────────────┘  │  │
│  │  ┌──────────┐  ┌────────────────┐  │  │
│  │  │  Flight   │  │  Controls      │  │  │
│  │  │  Model    │──│  (Keyboard)    │  │  │
│  │  └──────────┘  └────────────────┘  │  │
│  │  ┌────────────────────────────────┐  │  │
│  │  │  Atmosphere / Post-processing  │  │  │
│  │  │  (TBD)                         │  │  │
│  │  └────────────────────────────────┘  │  │
│  └────────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Module Responsibilities

### Scene Manager (`src/scene/`) — IMPLEMENTED
- Инициализация Three.js (WebGLRenderer, Scene, Camera)
- Рендер-луп через requestAnimationFrame с фиксацией dt
- Подписка onUpdate для кастомных хуков

### Planet Generator (`src/planet/`) — IMPLEMENTED
- **Geometry**: сфера (SphereGeometry) со смещением вершин через value noise FBM
- **Height map**: mulberry32 PRNG + билинейная интерполяция, CPU
- **Coloring**: биомы по нормализованной высоте (вода → песок → трава → лес → камень → снег)
- **Vertex colors**: через vertexColors на MeshStandardMaterial

### Flight Model (`src/flight/`) — IMPLEMENTED
- Физика самолёта (упрощённая: тяга, подъёмная сила, гравитация, лобовое сопротивление)
- Начальное состояние: в воздухе, с крейсерской скоростью
- Коллизия с поверхностью (clamp позиции, обнуление вертикальной скорости)
- Сброс состояния

### Controls (`src/controls/`) — IMPLEMENTED
- Управление с клавиатуры: W/S pitch, A/D yaw, Q/E roll, Shift/Ctrl throttle
- attach/detach жизненный цикл
- Сброс всех клавиш при потере фокуса (blur)
- Противоположные клавиши компенсируются (net sum = 0)

### Atmosphere (`src/atmosphere/`) — TBD

## Data Flow

```
User Input → KeyboardControls → FlightModel → position/orientation
                                                         ↓
SceneManager.onUpdate → camera follow → WebGLRenderer.render
         ↓
Planet (static mesh, generated once)
```

## Project Structure

```
planet/
├── CLAUDE.md
├── docs/
│   ├── architecture.md
│   └── specs.md
├── src/
│   ├── main.ts              # Entry point, wiring
│   ├── style.css
│   ├── scene/
│   │   ├── SceneManager.ts
│   │   └── SceneManager.test.ts
│   ├── planet/
│   │   ├── PlanetGenerator.ts
│   │   └── PlanetGenerator.test.ts
│   ├── flight/
│   │   ├── types.ts
│   │   ├── FlightModel.ts
│   │   └── FlightModel.test.ts
│   ├── controls/
│   │   ├── KeyboardControls.ts
│   │   └── KeyboardControls.test.ts
│   └── atmosphere/          # TBD
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Rendering Pipeline

1. Update controls state (getInput snapshot)
2. Step flight physics (dt из requestAnimationFrame, capped 30fps min)
3. Update camera (lookAt за позицией самолёта, сверху-сзади)
4. Render planet с освещением (DirectionalLight + AmbientLight)

## Performance

Текущая цель — 60 FPS на десктопе. Сегментация планеты: 48×48.

## Implementation Status

| Модуль | Статус | Тесты |
|--------|--------|-------|
| SceneManager | ✅ | 7 |
| PlanetGenerator | ✅ | 8 |
| FlightModel | ✅ | 10 |
| KeyboardControls | ✅ | 10 |
| Atmosphere | 📋 план | — |
| GamepadControls | 📋 план | — |
| LOD | 📋 план | — |

## Edge Cases

- Ground collision: position clamped, vertical speed zeroed
- Потеря фокуса: keyset cleared
- Нулевой радиус планеты: fallback к 1
- Сегментов < 4: clamp к 4
