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
| Тесты | Vitest | Совместимость с Vite, fast |
| Сервер | Vite dev server / static | Нет API, только статика |
| Шейдеры | GLSL (RawShaderMaterial) | Процедурная генерация на GPU |

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
│  │  │  Model    │──│  (Input)       │  │  │
│  │  └──────────┘  └────────────────┘  │  │
│  │  ┌────────────────────────────────┐  │  │
│  │  │  Atmosphere / Post-processing  │  │  │
│  │  └────────────────────────────────┘  │  │
│  └────────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Module Responsibilities

### Scene Manager (`src/scene/`)
- Инициализация Three.js (WebGLRenderer, Scene, Camera)
- Группировка объектов (планета, самолёт, небо)
- Рендер-луп с фиксированным шагом физики

### Planet Generator (`src/planet/`)
- **Geometry**: сфера с икосаэдрической подложкой, LOD
- **Height map**: симплекс-шум + фрактальный Brownian Motion на GPU
- **Coloring**: биомы по высоте/широте (вода, песок, трава, камень, снег)
- **Vertex shader**: смещение вершин по карте высот
- **Fragment shader**: заливка биомов + освещение

### Flight Model (`src/flight/`)
- Физика самолёта (упрощённая: тяга, подъёмная сила, гравитация, лобовое сопротивление)
- Машина состояний (полёт, круиз, пике)
- Привязка камеры (следящая камера от 3-го лица)

### Controls (`src/controls/`)
- Управление с клавиатуры (WASD + Q/E для кренов)
- Поддержка геймпада (опционально)
- Mouse look с зажатой ПКМ

### Atmosphere (`src/atmosphere/`)
- Рассеяние Рэлея (sky shader)
- Слой облаков (2D-шум на сфере)

## Data Flow

```
User Input → Controls → Flight Model → Transform → Scene → Render
                                      ↓
                              Planet (static transform)
```

## Project Structure

```
planet/
├── docs/
│   └── architecture.md
├── src/
│   ├── main.ts              # Entry point
│   ├── types.ts              # Shared types
│   ├── scene/
│   │   ├── SceneManager.ts
│   │   └── SceneManager.test.ts
│   ├── planet/
│   │   ├── PlanetGenerator.ts
│   │   ├── noise.glsl         # GPU noise functions
│   │   ├── planet.vert.glsl   # Vertex displacement shader
│   │   ├── planet.frag.glsl   # Fragment biome shader
│   │   └── PlanetGenerator.test.ts
│   ├── flight/
│   │   ├── types.ts
│   │   ├── FlightModel.ts
│   │   ├── FlightModel.test.ts
│   │   └── FlightModel.integration.test.ts
│   ├── controls/
│   │   ├── KeyboardControls.ts
│   │   ├── KeyboardControls.test.ts
│   │   └── GamepadControls.ts
│   └── atmosphere/
│       ├── Atmosphere.ts
│       └── Atmosphere.test.ts
├── public/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

## Rendering Pipeline

1. Update controls state (input snapshot)
2. Step flight physics (fixed timestep, 120Hz)
3. Update camera (lerp to target position behind plane)
4. Render planet (displacement shader runs on GPU)
5. Render atmosphere/clouds
6. Post-processing (bloom, vignette)

## Performance Targets

- **Desktop**: 60 FPS при полном LOD
- **Mobile**: 30 FPS, пониженное качество шума
- **Draw calls**: < 100
- **Память**: < 256MB GPU

## Edge Cases / States

- Loading: спиннер/прогресс-бар при компиляции шейдеров
- Empty: начальное состояние до загрузки
- Error: падение WebGL → сообщение пользователю
- Edge: облёт на высокой скорости — плавный LOD переход
- Edge: уход под поверхность — отключение коллизии (проходим сквозь)
