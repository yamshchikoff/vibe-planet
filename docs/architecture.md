# Planet — Procedural Planet Generator & Flight Simulator

**License:** MIT. See [LICENSE](../LICENSE) in repository root.
All implementation must be checked for compliance with the MIT License terms before distribution.

## Vision

Браузерное приложение, генерирующее процедурную планету с возможностью облетать её на самолёте. Весь рендеринг и игровая логика — на клиенте. Веб-сервер нужен только для раздачи статики.

## Development Protocol (строгий)

Разработка управляется документацией и тестами (Documentation-Driven & Test-Driven Development).

### Фазы (обязательный порядок)

1. **Документация** — написать или обновить `docs/` и `CLAUDE.md` под планируемое изменение
2. **Тесты** — написать `*.test.ts`, убедиться что падают (RED)
3. **Реализация** — написать код, проходящий тесты (GREEN)
4. **Синк документации** — перечитать `docs/`, проверить консистентность с кодом и тестами; если docs отстают — обновить
5. **Визуальная проверка** — быстрый цикл (`npm run dev`, host) или полный цикл (QEMU VM); см. `CLAUDE.md` → Debug Loops

### Commits — строгие категории

Каждый коммит содержит файлы **только одной категории**. Микс категорий запрещён.

| Префикс | Содержимое коммита |
|---------|-------------------|
| `docs:` | только `docs/`, `CLAUDE.md` |
| `test:` | только `*.test.ts` |
| `feat:` | только реализация (`.ts`, `.css`, `.html`) |
| `fix:` | только исправление (`.ts`) |
| `chore:` | конфиги, скаффолд (`.json`, `.config.*`) |

### Правила работы с репозиторием

1. **Каждый коммит — пуш в оба remote:** после коммита обязательно `git push github master && git push gitflic master`. Remote-ы должны быть синхронизированы всегда.
2. **Force push запрещён** на любой remote в любой ветке. История — неприкосновенна. Если нужно исправить коммит — делается новый коммит сверху.
3. **Фича-бранчи:** каждое отдельное направление разработки ведётся в своей ветке (`feat/babylon-migration`, `feat/clouds`, `fix/shadow-acne` и т.д.). В `master` мерж через `git merge --no-ff` после ревью и зелёных тестов.

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

## Running

У нас три среды отладки:

| Среда | Команда | Назначение |
|-------|---------|-----------|
| **Host (fast loop)** | `npm run dev` → http://localhost:8080/ | Итерация кода, HMR, 95% разработки |
| **Dev VM (Ubuntu Desktop)** | Chrome на 192.168.181.129 | Визуальная проверка, скриншоты через CDP |
| **Deploy VM (QEMU Alpine)** | `npm run build` → boot → deploy | Детерминизм, герметичность, финальная проверка |

**Dev VM доступ:** SSH `claude@192.168.181.129` (ключ). Chrome remote debugging на порту 9222,
SSH tunnel `-L 9222:localhost:9222`. CDP скриншоты через `Page.captureScreenshot`.
Подробности — в `CLAUDE.md` → Dev VM.

## Technology Stack

| Компонент | Технология | Обоснование |
|-----------|-----------|-------------|
| 3D-движок | Babylon.js 9 | CSM, PBR, WebGPU, нет багов depth/shadows |
| Язык | TypeScript | Типизация, автодополнение |
| Сборка | Vite | Быстрая dev-сборка, HMR |
| Тесты | Vitest + jsdom | Совместимость с Vite, окружение DOM |
| Сервер | Vite dev / Python http.server / QEMU | См. docs/qemu-vm.md |
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
│  │  │  Sun (lighting + sun disc)     │  │  │
│  │  └────────────────────────────────┘  │  │
│  └────────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Module Responsibilities

### Scene Manager (`src/scene/`) — IMPLEMENTED
- Инициализация Babylon.js Engine + Scene + Camera
- Рендер-луп через engine.runRenderLoop с фиксацией dt
- Подписка onUpdate для кастомных хуков
- CSM (Cascaded Shadow Maps) из коробки

### LODPlanet (`src/planet/`) — REDESIGN PLANNED

Текущая реализация отключена (не работала после миграции на Babylon.js).
Разработана новая архитектура и спецификации требований, см.:

- `docs/LOD-chunk-system.md` — спецификация требований к LOD Chunk System
- `docs/LOD-architecture.md` — верхнеуровневая архитектура (11 компонентов)
- `docs/LOD/` — 11 покомпонентных спецификаций требований

**Целевая архитектура:**
- **PlanetRoot**: фасад, владеет всеми подсистемами
- **QuadtreeManager**: логическое квадродерево на 6 гранях
- **LODEvaluator**: screen-space error, 1px порог, экспоненциальные параметры
- **BoundaryContractEngine**: граничные контракты, C⁰/G¹, межконтрактный интерфейс
- **ChunkGenerator**: contract-first генерация геометрии
- **HeightSampler**: детерминированное FBM сэмплирование
- **CacheSubsystem**: LRU-кэш, write-through для deformation
- **AsyncJobScheduler**: точечная выгрузка в Web Worker
- **PolarTopologyHandler**: топологическая сингулярность полюсов
- **DeformationSystem**: разрушающие изменения (будущее)
- **ContractVerifier**: DEBUG-проверки инвариантов

### HeightSampler (`src/planet/`) — IMPLEMENTED
- 3D value noise с hash-функцией и seed-ом
- FBM: lacunarity 2.0, gain 0.5, 12 октав (фрактальная поверхность с деталью до ~100 м)
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
- Визуализация самолёта из MeshBuilder.CreateBox + PBRMaterial
- Scale: 0.006 (истребитель 15 м × 9 м — F-16-class)
- Позиционирование через update(position, yaw, pitch, roll)
- Шесть частей: фюзеляж, нос, кабина, крылья, хвостовые стабилизаторы, киль

### Atmosphere (`src/atmosphere/`) — DEFERRED
- Атмосферный скейтеринг будет реализован в последнюю очередь, после ландшафта и освещения
- План: шейдерный скейтеринг (BackSide сфера, rim lighting + sun angle)
- Parameters: planetRadius 6371, atmosphereHeight 80 km

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
│   ├── plane/
│   │   ├── PlaneVisual.ts
│   │   └── PlaneVisual.test.ts
│   ├── atmosphere/
│   │   ├── Sun.ts
│   │   └── Sun.test.ts
│   ├── camera/
│   │   ├── ChaseCamera.ts
│   │   └── ChaseCamera.test.ts
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
   Babylon.js TransformNode задаёт смещение worldGroup, объекты рендерятся в локальной системе координат.
6. Update Sun uniforms
7. Render planet chunks → sun disc
   (атмосфера отложена — будет добавлена после ландшафта и освещения)

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
| SceneManager | ✅ | 10 |
| FlightModel | ✅ | 20 |
| KeyboardControls | ✅ | 10 |
| LODPlanet | ✅ | 13 (6+7 skip) |
| HeightSampler | ✅ | 6 |
| PlaneVisual | ✅ | 4 |
| Atmosphere | ⏳ отложено | — |
| Sun | ✅ | 15 (7+8 skip) |
| ChaseCamera | ✅ | 5 |
| main | ✅ | 3 |
| GamepadControls | 📋 план | — |

## Edge Cases

- Ground collision: position clamped, vertical speed zeroed
- Потеря фокуса: keyset cleared
- Нулевой радиус планеты: fallback к 1
- Сегментов < 4: clamp к 4
