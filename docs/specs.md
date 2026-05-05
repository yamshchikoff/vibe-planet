# Module Specifications

## 1. SceneManager (`src/scene/`)

### Responsibility
Инициализирует Three.js, владеёт render loop и композицией сцены.

### API

```ts
class SceneManager {
  constructor(canvas: HTMLCanvasElement)
  start(): void               // запускает render loop
  stop(): void                // останавливает render loop
  resize(): void              // подгоняет размер под window.innerWidth/Height
  getScene(): THREE.Scene
  getCamera(): THREE.PerspectiveCamera
  getRenderer(): THREE.WebGLRenderer
  onUpdate(cb: (dt: number) => void): void  // регистрирует хук в render loop
}
```

### States
- **idle**: создан, не стартован
- **running**: цикл рендера активен
- **stopped**: цикл остановлен

### Edge Cases
- Canvas нулевого размера → ресайз при старте
- Окно меняет размер → слушатель `window.resize`, обновление камеры и рендерера
- Потеря WebGL контекста → авто-восстановление (Three.js default handler)
- Первый кадр: коллбэки onUpdate вызываются сразу (lastTime инициализируется при старте, а не в первом loop)
- Большая сцена (радиус планеты 6371): WebGLRenderer включает logarithmicDepthBuffer

---

## 2. LODPlanet (`src/planet/`)

### Responsibility
Ленивая процедурная генерация планеты земного типа с LOD.
Cube-sphere с квадродеревом: 6 граней куба, каждая subdivided через quadtree.
Только видимые и ближайшие к камере чанки генерируются.
Сгенерированные чанки кэшируются на сессию (ключ = seed + quad-путь).

### Scale
- 1 unit = 1 km
- Radius: 6371 (Earth radius)
- Terrain amplitude: 0–8 units (0–8 km высота)
- Spawn altitude: 2 units над поверхностью

### LOD System

```
6 cube faces → quadtree per face
  depth 0: вся грань (1 чанк)
  depth d: 4^d чанков на грань, каждый 1/2^d ребра грани

Каждый чанк-лист: меш с фиксированной сеткой (16×16 вершин)
Мирный размер чанка на глубине d ≈ π·R / (2·2^d)
```

Глубина чанка выбирается по расстоянию от камеры до центра чанка:

| Distance from surface | Max depth | Vertex spacing |
|----------------------|-----------|---------------|
| > 500 km | 3 | ~50 km |
| 100–500 km | 5 | ~12 km |
| 10–100 km | 7 | ~3 km |
| 1–10 km | 9 | ~800 m |
| < 1 km | 11 | ~200 m |

### Height Function
- 3D seeded hash → value noise
- FBM 6 октав с затуханием 0.5
- Высота нормализована в [0, 1], затем scaled к terrain amplitude
- Детерминированна: seed + координаты → всегда тот же результат
- Бесшовна: 3D noise не имеет UV-швов

### Biome Mapping (by normalized height + latitude)

| Height | Biome | Color |
|--------|-------|-------|
| < 0.1 | Deep Water | #1a3d6b |
| 0.1 – 0.25 | Shallow Water | #2980b9 |
| 0.25 – 0.3 | Sand/Beach | #d4a76a |
| 0.3 – 0.55 | Grassland | #4a8c3f |
| 0.55 – 0.7 | Forest | #2d5a27 |
| 0.7 – 0.85 | Rock | #7a7a7a |
| 0.85 – 1.0 | Snow | #f0f0f0 |

Выше 60° широты: snow threshold смещается вниз (полярные шапки).

### API

```ts
interface LODConfig {
  planetRadius: number;      // default: 6371
  seed: number;              // default: random
  heightAmplitude: number;   // default: 8
  maxDepth: number;          // max quadtree depth, default: 12
  maxChunks: number;         // cache size, default: 1000
  chunkResolution: number;   // вершин на ребро чанка, default: 16
}

class LODPlanet {
  constructor(config?: Partial<LODConfig>)
  getMesh(): THREE.Group              // группа со всеми активными чанками
  update(cameraPos: THREE.Vector3): void // обновление LOD
  getHeightAt( worldPos: THREE.Vector3 ): number  // высота в точке (коллизии)
  dispose(): void                     // освободить всё
}
```

### Caching

- Map<string, ChunkData> — ключ `f{d}-d{depth}-{x}-{y}`
- ChunkData: { mesh, material, geometry, lastAccess }
- LRU: при превышении maxChunks, удаляются самые старые неиспользуемые
- При удалении: geometry.dispose(), material.dispose()
- При повторном запросе того же ключа: возвращается кэш (та же геометрия)

### States
- **idle**: создан, не обновлялся, ни одного чанка
- **active**: чанки генерируются/обновляются
- **disposed**: все ресурсы освобождены

### Edge Cases
- Камера под поверхностью → генерация продолжается (может вылезти наружу)
- Пустой кэш при первом обновлении → генерация корневых чанков
- Высота > maxDepth → clamp к maxDepth
- Планета радиуса 0 → fallback к 1
- Камера очень далеко (> 10× radius) → только depth 0–1
- Утечка памяти: LRU не даёт превысить maxChunks

---

## 3. FlightModel (`src/flight/`)

### Responsibility
Упрощённая физика самолёта с фиксированным шагом обновления.
Масштаб: 1 unit = 1 km. Планета земного типа, радиус 6371 km.

### Constants

```
GRAVITY = 0.0098 (km/с²)
MAX_THRUST = 0.015 (km/с²)
DRAG_COEFF = 0.00002
LIFT_COEFF = 0.00008
THROTTLE_RATE = 2.0 (единиц/с)
ROTATION_RATE = 2.0 (рад/с)
PLANET_RADIUS = 6371
START_ALTITUDE = 2 (km)
```

### Physics Model (simplified)

```
thrust = throttle * MAX_THRUST
drag = DRAG_COEFF * speed²
lift = LIFT_COEFF * speed² * cos(pitch)
gravity_component = GRAVITY * sin(pitch)  // along velocity direction
vertical_gravity = GRAVITY * cos(pitch)   // toward planet center

acceleration_forward = thrust - drag - gravity_component
acceleration_up = lift - vertical_gravity

// Velocity update (in local frame)
speed += acceleration_forward * dt
vertical_speed += acceleration_up * dt
```

### API

```ts
class FlightModel {
  constructor(planetRadius?: number)
  getState(): FlightState
  applyControls(input: ControlInput): void
  update(dt: number): void       // фиксированный шаг, ожидается 1/60
  reset(): void                  // сброс в начальное состояние
}
```

### Initial State
- Position: `[0, planetRadius + START_ALTITUDE, 0]` — над северным полюсом
- Velocity: `[0, 0, -8]` — тангенциально поверхности (к экватору)
- Orientation: yaw=0, pitch=0, roll=0
- Throttle: 0 (планирование)
- Speed: 8 km/с (крейсерская)

### Collision
- Минимальная высота = `PLANET_RADIUS`
- При касании: vertical_speed обнуляется, position clamp. Горизонтальная скорость сохраняется.

### States
- **flying**: y > radius, speed > 0

---

## 4. Controls (`src/controls/`)

### Responsibility
Обрабатывает пользовательский ввод и нормализует его в `ControlInput`.

### Keyboard Map

| Key | Axis | Value |
|-----|------|-------|
| W | pitch | +1 |
| S | pitch | -1 |
| A | yaw | +1 |
| D | yaw | -1 |
| Q | roll | -1 |
| E | roll | +1 |
| Shift | throttle | +1 |
| Ctrl | throttle | -1 |
| R | reset | — |

### API

```ts
class KeyboardControls {
  constructor()
  attach(): void                      // подписаться на keydown/keyup
  detach(): void                      // отписаться
  getInput(): ControlInput           // текущий снапшот состояния
}
```

### States
- **detached**: не слушает события
- **attached**: слушает и аккумулирует ввод

### Edge Cases
- Потеря фокуса окном → все клавиши сбрасываются в нейтраль
- Зажатие нескольких клавиш с противоположными знаками → суммарный ноль

---

## 5. Atmosphere (`src/atmosphere/`)

### Responsibility
Атмосферное рассеяние (shader-based), скайбокс, облачный слой.
Рендерится как fullscreen post-process или сфера вокруг планеты.

### API

```ts
interface AtmosphereConfig {
  planetRadius: number;         // default: 6371
  atmosphereHeight: number;     // default: 80 (80 km)
}

class Atmosphere {
  constructor(config: AtmosphereConfig)
  getMesh(): THREE.Mesh           // сфера атмосферы
  update(cameraPos: THREE.Vector3, sunDir: THREE.Vector3): void  // uniform-ы
  dispose(): void
}
```

### Scattering Model
- Rayleigh scattering (синий цвет) + Mie scattering (дымка)
- Inscattering цвет зависит от угла солнце-камера
- Прозрачность: от поверхности (непрозрачно) до края (прозрачно)
- Камера внутри атмосферы: корректный цвет неба во все стороны

### Cloud Layer
- Прозрачная сфера поверх планеты на высоте 5–10 km
- Шумовая 2D текстура как альфа-маска
- Медленное вращение (отдельное от планеты)

### Edge Cases
- Камера внутри атмосферы → корректный цвет неба
- Камера снаружи → прозрачная атмосфера
- Большая высота (> 200 km) → атмосфера не рендерится

---

## 5b. Sun (`src/atmosphere/Sun.ts`)

### Responsibility
Солнечное освещение сцены. DirectionalLight + визуальный диск солнца.

### API

```ts
interface SunConfig {
  inclination: number;  // угол к оси планеты (default: 0.41 ≈ 23.5°)
  longitude: number;    // долгота, default: 0
}

class Sun {
  constructor(config?: Partial<SunConfig>)
  getLight(): THREE.DirectionalLight     // свет для сцены
  getDirection(): THREE.Vector3          // направление на солнце (world)
  update(time: number): void             // вращение по времени
  dispose(): void
}
```

### Поведение
- DirectionalLight с интенсивностью 1.5
- Цвет: #fff5e6 (тёплый белый)
- Вращается вокруг планеты по времени (полный оборот = 120 секунд демо-времени)
- Солнечный диск: спрайт или меш на бесконечности (далеко за атмосферой)

### Edge Cases
- Солнце за горизонтом → AmbientLight минимальный
- Переход день/ночь → плавная интерполяция интенсивности

---

## 6. PlaneVisual

### Responsibility
Создаёт и обновляет трёхмерную визуализацию самолёта из примитивов Three.js.

### API

```ts
class PlaneVisual {
  constructor()
  getMesh(): THREE.Group
  update(position: [number, number, number], yaw: number, pitch: number, roll: number): void
  dispose(): void
}
```

### Состав меша (базовые размеры ×8 scale для 20 м длины)
Ось Z — продольная (нос в −Z, хвост в +Z). Ось Y — вертикальная. Ось X — поперечная (крылья).
BoxGeometry параметры: (ширина X, высота Y, глубина Z).
- Фюзеляж: Box (0.35 × 0.35 × 2.5), цвет #5a5a5a
- Нос: Box (0.25 × 0.25 × 0.3), цвет #4a4a4a
- Кабина: Box (0.2 × 0.12 × 0.4), цвет #88ccff
- Крылья основные: Box (4.0 × 0.04 × 0.08), цвет #6a6a6a
- Хвостовые стабилизаторы: Box (1.2 × 0.04 × 0.08), цвет #6a6a6a
- Киль (вертикальный): Box (0.3 × 0.6 × 0.08), цвет #5a5a5a
- Group.scale = (8, 8, 8)

---

## 7. Controls Overlay

### Responsibility
Показывает шпаргалку по управлению поверх канваса.

### Расположение
- Нижний край экрана, полупрозрачный фон
- Персистентна (всегда видна)
- Toggle по клавише H

### Содержимое

| Клавиша | Действие |
|---------|----------|
| W/S | Нос вверх/вниз |
| A/D | Поворот влево/вправо |
| Q/E | Крен |
| Shift | Газ + |
| Ctrl | Газ - |
| H | Шпаргалка
