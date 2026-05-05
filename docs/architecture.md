# Planet — Procedural Planet Generator & Flight Simulator

## Vision

Браузерное приложение, генерирующее процедурную планету с возможностью облетать её на самолёте. Весь рендеринг и игровая логика — на клиенте. Веб-сервер нужен только для раздачи статики.

## Development Protocol (строгий)

Разработка управляется документацией и тестами (Documentation-Driven & Test-Driven Development).

### Фазы (обязательный порядок)

1. **Документация** — написать или обновить `docs/` и `CLAUDE.md` под планируемое изменение
2. **Тесты** — написать `*.test.ts`, убедиться что падают (RED)
3. **Реализация** — написать код, проходящий тесты (GREEN)
4. **Синк документации** — перечитать `docs/`, проверить консистентность с кодом и тестами; если docs отстают — обновить
5. **Визуальная проверка** — `npm run dev`, проверить в браузере

### Commits — строгие категории

Каждый коммит содержит файлы **только одной категории**. Микс категорий запрещён.

| Префикс | Содержимое коммита |
|---------|-------------------|
| `docs:` | только `docs/`, `CLAUDE.md` |
| `test:` | только `*.test.ts` |
| `feat:` | только реализация (`.ts`, `.css`, `.html`) |
| `fix:` | только исправление (`.ts`) |
| `chore:` | конфиги, скаффолд (`.json`, `.config.*`) |

### Пример цикла

```
docs:  add atmosphere module spec
test:  atmosphere shader and cloud layer
feat:  atmosphere scattering and cloud layer
docs:  sync specs with actual implementation
```

### Правила

- Ни одна фича не реализуется без теста
- Тест должен упасть до реализации (RED → GREEN)
- Рефакторинг — только при зелёных тестах
- После коммита реализации — обязательная сверка `docs/` с кодом

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
│  │  │  Scene    │  │  LODPlanet     │  │  │
│  │  │  Manager  │──│  HeightSampler │  │  │
│  │  └──────────┘  └────────────────┘  │  │
│  │  ┌──────────┐  ┌────────────────┐  │  │
│  │  │  Flight   │  │  Controls      │  │  │
│  │  │  Model    │──│  (Keyboard)    │  │  │
│  │  └──────────┘  └────────────────┘  │  │
│  │  ┌────────────────────────────────┐  │  │
│  │  │  PlaneVisual                   │  │  │
│  │  └────────────────────────────────┘  │  │
│  │  ┌────────────────────────────────┐  │  │
│  │  │  Atmosphere + Sun              │  │  │
│  │  │  (shader scattering)           │  │  │
│  │  └────────────────────────────────┘  │  │
│  └────────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Module Responsibilities

### Scene Manager (`src/scene/`) — IMPLEMENTED
- Инициализация Three.js (WebGLRenderer, Scene, Camera)
- Рендер-луп через requestAnimationFrame с фиксацией dt
- Подписка onUpdate для кастомных хуков

### LODPlanet (`src/planet/`) — IMPLEMENTED
- **Geometry**: cube-sphere с квадродеревом (6 граней куба, quadtree subdivision)
- **LOD**: split по расстоянию от камеры, maxDepth 12, effectiveDepth снижается с высотой
- **Height map**: 3D seeded value noise FBM (6 октав, scale 200), детерминированно
- **Terrain amplitude**: 0–8 km (normalized noise [0, 1] × heightAmplitude)
- **Coloring**: биомы по нормализованной высоте + широте (vertex colors); границы возмущены 3D FBM domain warp для фрактальных изолиний
- **Caching**: LRU-кэш чанков (max 1000), ключ = `f{face}-d{depth}-{x}-{y}`
- **Chunk resolution**: 16×16 вершин на чанк

### HeightSampler (`src/planet/`) — IMPLEMENTED
- 3D value noise с hash-функцией и seed-ом
- FBM: lacunarity 2.0, gain 0.5, 6 октав
- Выход: normalized [0, 1]
- Бесшовный (3D noise, нет UV-швов)

### Flight Model (`src/flight/`) — IMPLEMENTED
- Физика самолёта (упрощённая: тяга, гравитация, лобовое сопротивление; velocity = forward × speed)
- **Ориентация: кватернион**, roll/pitch — локальные оси (right-multiply), yaw — мировая Y (left-multiply)
- **Coordinated turn**: при крене автоповорот вокруг мировой Y, плавный и пропорциональный bank
- Начальное состояние: в воздухе, с крейсерской скоростью
- Коллизия с поверхностью (clamp позиции)
- Сброс состояния

### Controls (`src/controls/`) — IMPLEMENTED
- Управление с клавиатуры: W/S pitch, A/D roll, Q/E yaw, Shift/Ctrl throttle
- attach/detach жизненный цикл
- Сброс всех клавиш при потере фокуса (blur)
- Противоположные клавиши компенсируются (net sum = 0)

### PlaneVisual (`src/plane/`) — IMPLEMENTED
- Визуализация самолёта из примитивов Three.js (BoxGeometry)
- Scale: 0.006 (истребитель 15 м × 9 м — F-16-class)
- Позиционирование через update(position, yaw, pitch, roll)
- Шесть частей: фюзеляж, нос, кабина, крылья, хвостовые стабилизаторы, киль

### Atmosphere (`src/atmosphere/`) — IMPLEMENTED
- **Scattering**: шейдерный атмосферный скейтеринг (BackSide сфера, rim lighting + sun angle)
- **Parameters**: planetRadius 6371, atmosphereHeight 80 km
- **Прозрачность**: затухание от поверхности до края атмосферы
- **Интеграция**: получает направление солнца из Sun, обновляется каждый кадр

### Sun (`src/atmosphere/`) — IMPLEMENTED
- DirectionalLight + AmbientLight с дневным/ночным циклом
- Полный оборот за 120 секунд демо-времени
- Аксиальный наклон 23.5°
- Плавная интерполяция интенсивности день/ночь

## Data Flow

```
User Input → KeyboardControls → FlightModel → position/orientation
                                                         ↓
                                          PlaneVisual.update(pos, yaw, pitch, roll)
                                                         ↓
SceneManager.onUpdate → camera follow → LODPlanet.update(cameraPos)
                                           Atmosphere.update(cameraPos, sunDir)
                                           Sun.update(dt)
                                                         ↓
                                    Floating origin → WebGLRenderer.render
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
│   │   ├── HeightSampler.ts
│   │   ├── HeightSampler.test.ts
│   │   ├── LODPlanet.ts
│   │   ├── LODPlanet.test.ts
│   │   ├── PlanetGenerator.ts    # replaced by LODPlanet
│   │   └── PlanetGenerator.test.ts
│   ├── plane/
│   │   ├── PlaneVisual.ts
│   │   └── PlaneVisual.test.ts
│   ├── atmosphere/
│   │   ├── Atmosphere.ts
│   │   ├── Sun.ts
│   ├── flight/
│   │   ├── types.ts
│   │   ├── FlightModel.ts
│   │   └── FlightModel.test.ts
│   ├── controls/
│   │   ├── KeyboardControls.ts
│   │   └── KeyboardControls.test.ts
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Rendering Pipeline

1. Update controls state (getInput snapshot)
2. Step flight physics (dt из requestAnimationFrame, capped 30fps min)
3. Update LODPlanet: traverse quadtree, split/merge по расстоянию, generate/ cache chunks
4. Update camera (15 м позади, 6 м выше самолёта, lookAt на самолёт, FOV 85°)
5. Floating origin: worldGroup.position = -camera.position, затем camera.position = (0, 0, 0).  
   Таким образом Three.js view matrix translate(-camera.position) = identity,  
   и рендер происходит в системе координат worldGroup (объекты смещены относительно камеры).  
   После коллбэков camera.position — это желаемая позиция камеры в мире; loop читает её,  
   смещает worldGroup, сбрасывает камеру в origin и рендерит.
6. Update Atmosphere + Sun uniforms
7. Render planet chunks → atmosphere → (в перспективе clouds)

### Camera

- FOV: 85° (широкий для близкой chase камеры)
- Near plane: 0.001 km (1 m) — для камеры в 15 м от самолёта
- Позиция: 15 м позади (+Z), 6 м выше (+Y) в локальной системе самолёта
- Ориентация: независимая от самолёта — всегда смотрит на самолёт (lookAt)
- Следование: мгновенное (позиция вычисляется каждый кадр), без лага
- При крене и тангаже самолёта камера не заваливается — stays upright, plane always centred
- Floating origin: каждый кадр worldGroup смещается на -camera.position, камера в начале координат

## Scale

- 1 unit = 1 km
- Planet radius: 6371 (Earth radius)
- Spawn altitude: 2 km над поверхностью полюса
- Скорость самолёта: 0.5 km/с (крейсерская, ~Mach 1.5)

## Performance

Текущая цель — 60 FPS на десктопе. Chunked LOD с cube-sphere.
Максимум 500–1000 чанков в кэше (LRU). Вершин на чанк: 16×16.

## Implementation Status

| Модуль | Статус | Тесты |
|--------|--------|-------|
| SceneManager | ✅ | 12 |
| PlanetGenerator | ❌ заменён | — |
| FlightModel | ✅ | 20 |
| KeyboardControls | ✅ | 10 |
| LODPlanet | ✅ | 10 |
| HeightSampler | ✅ | 6 |
| PlaneVisual | ✅ | 5 |
| Atmosphere | ✅ | 16 |
| Sun | ✅ | 13 |
| GamepadControls | 📋 план | — |

## Edge Cases

- Ground collision: position clamped, vertical speed zeroed
- Потеря фокуса: keyset cleared
- Нулевой радиус планеты: fallback к 1
- Сегментов < 4: clamp к 4
