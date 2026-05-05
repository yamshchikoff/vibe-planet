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
- FBM 12 октав с затуханием 0.5 (спектральный exponent β=1, 1/f noise)
- Высота нормализована в [0, 1], затем scaled к terrain amplitude
- Минимальная длина волны: 200 / 2¹¹ ≈ 100 м (фрактальная деталь до ~100 м)
- Детерминированна: seed + координаты → всегда тот же результат
- Бесшовна: 3D noise не имеет UV-швов

### Biome Mapping (by normalized height + latitude)

Biomes are blended smoothly — colors interpolate via smoothstep between adjacent thresholds,
eliminating hard seams at chunk boundaries.

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
Переходы между биомами — плавные (smoothstep, без if/else-скачков).

### Fractal Boundaries

Границы биомов возмущаются 3D FBM-шумом (domain warp), чтобы изолинии не были прямыми:

- **Scale**: 500 km (базовая длина волны)
- **Octaves**: растут с глубиной LOD (2 на depth 0 → 6 на depth 4+)
- **Amplitude**: 0.035 (≈280 м эквивалентного смещения высоты)
- **Seed**: общий с HeightSampler, детерминирован
- **Результат**: на дальних дистанциях — континентальные изгибы, вблизи — фрактальные детали до масштаба ~сотен метров

### API

```ts
interface LODConfig {
  planetRadius: number;        // default: 6371
  seed: number;              // default: random
  heightAmplitude: number;   // default: 8
  maxDepth: number;          // max quadtree depth, default: 12
  maxChunks: number;         // cache size, default: 1000
  chunkResolution: number;   // вершин на ребро чанка, default: 16
  biomeWarpAmplitude: number; // фрактальное возмущение биомов, default: 0.035
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
MAX_THRUST = 0.1 (km/с²)
DRAG_COEFF = 0.08
THROTTLE_RATE = 4.0 (единиц/с)
ROLL_RATE = 2.0 (рад/с)
PITCH_RATE = 2.0 (рад/с)
YAW_RATE = 0.5 (рад/с)
COORD_TURN_RATE = 0.6
PLANET_RADIUS = 6371
START_ALTITUDE = 2 (km)
START_SPEED = 0.5 (km/с)     — ~Mach 1.5
START_THROTTLE = 0.2          — равновесие thrust = drag на START_SPEED
```

### Orientation Model (quaternion)

Ориентация самолёта хранится как `THREE.Quaternion`. Управление:

- **Roll (A/D)** — вращение вокруг **локальной** оси Z (right-multiply: `q = q * q_roll`).  
  Элероны. Крен наклоняет вектор подъёмной силы, вызывая поворот.
- **Pitch (W/S)** — вращение вокруг **локальной** оси X (right-multiply: `q = q * q_pitch`).  
  Руль высоты. При крене 90° питж ведёт к развороту в горизонтальной плоскости.
- **Yaw (Q/E)** — вращение вокруг **мировой** оси Y (left-multiply: `q = q_yaw * q`).  
  Руль направления. Низкая скорость (YAW_RATE = 0.5), не вызывает крен.

### Coordinated Turn

При наличии крена (bank angle) самолёт автоматически разворачивается:

```
turnRate = COORD_TURN_RATE * sin(bankAngle)
q *= q_y(turnRate * dt)
```

- COORD_TURN_RATE = 0.6
- Поворот плавный, пропорциональный углу крена
- Без крена самолёт летит прямо
- При крене 45° полный круг за ~15 секунд

Ограничение: pitch clamped в [-π/2, π/2] для избежания gimbal lock.

### Throttle Response

Отклик самолёта на изменение газа:

- **THROTTLE_RATE = 4.0**: throttle переводится из 0 → 1 за ~0.25 с непрерывного нажатия Shift
- **MAX_THRUST = 0.1 (km/с²)**: максимальная тяга двигателя
- **DRAG_COEFF = 0.08**: лобовое сопротивление (пропорционально v²)

Ожидаемое поведение на крейсерской скорости (0.5 km/с, горизонт):

| Режим | Net ускорение | Эффект |
|-------|--------------|--------|
| Полный газ (Shift) | ~0.08 km/с² | разгон 0.5 → 0.7 km/с за ~3 с |
| Ноль газа (throttle=0) | ~-0.02 km/с² | замедление 0.5 → 0.44 km/с за ~3 с |
| Равновесие (drag = thrust) | 0 | v_terminal = sqrt(MAX_THRUST / DRAG_COEFF) ≈ 1.12 km/с |

Throttle 0 → скорость падает до ~0.2 km/с за ~15 с.
Throttle 1 → скорость растёт до ~1.0 km/с за ~8 с.

### Physics Model (simplified, 3D)

Самолёт движется строго в направлении продольной оси (forward):

```
forward = (0, 0, -1) × q  (мир. система)

thrust = throttle * MAX_THRUST          // вдоль forward
drag = DRAG_COEFF * speed²              // против forward
grav_along_forward = GRAVITY * forward.y

acceleration_forward = thrust - drag - grav_along_forward

// Интеграция скорости
speed += acceleration_forward * dt

// Позиция и скорость — строго вдоль forward
position += forward * speed * dt
velocity = forward * speed
```

Вектор скорости всегда совпадает с продольной осью самолёта — бокового скольжения нет.
Вертикальное движение определяется проекцией forward на мировую Y (forward.y).

При крене lift_vertical уменьшается (localUp.y < 1), самолёт теряет высоту,
если не скомпенсировать тангажом.

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

### FlightState

```ts
interface FlightState {
  position: [number, number, number];
  velocity: [number, number, number];
  orientation: { yaw: number; pitch: number; roll: number }; // из кватерниона, Euler XYZ
  throttle: number;
  speed: number;
}
```

Поля `orientation` вычисляются из внутреннего кватерниона через `Euler.setFromQuaternion(q, 'XYZ')`.
Порядок Euler XYZ: pitch (X) → yaw (Y) → roll (Z).

### Initial State
- Position: `[0, planetRadius + START_ALTITUDE, 0]` — по умолчанию над северным полюсом; конфигурируется через `spawnPosition` в конструкторе
- Velocity: `[0, 0, -0.5]` — тангенциально поверхности (к экватору)
- Orientation: yaw=0, pitch=0, roll=0 (identity quaternion)
- Throttle: 0.2 (крейсерский режим, равновесие thrust = drag)
- Speed: 0.5 km/с (~Mach 1.5)

### Collision
- Радиальная дистанция от центра планеты (не координата Y)
- При касании: position clamp к сфере, скорость ×0.99
- Работает в любой точке поверхности

### States
- **flying**: y > radius, speed > 0

---

## 4. Controls (`src/controls/`)

### Responsibility
Обрабатывает пользовательский ввод и нормализует его в `ControlInput`.

### Keyboard Map

| Key | Axis | Value | Аналог в самолёте |
|-----|------|-------|-------------------|
| W | pitch | +1 | штурвал на себя (кабрирование) |
| S | pitch | -1 | штурвал от себя (пикирование) |
| A | roll | +1 | штурвал влево (левый крен) |
| D | roll | -1 | штурвал вправо (правый крен) |
| Q | yaw | +1 | правая педаль (рывок вправо) |
| E | yaw | -1 | левая педаль (рывок влево) |
| Shift | throttle | +1 | сектор газа вперёд |
| Ctrl | throttle | -1 | сектор газа назад |
| R | reset | — | сброс |

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

### Scattering Model (current implementation)
- **Rim-based shader**: BackSide сфера вокруг планеты (радиус R + H/2 = 6411 km)
- **Лимб-свечение**: `rim = 1 - dot(viewDir, normal)`, возведённое в 3-ю степень — атмосфера видна только у горизонта
- **Солнечное освещение**: угол между нормалью и солнцем (`sunAngle`) делает обращённую к солнцу сторону ярче
- **Плотность**: экспоненциальное затухание с высотой: `exp(-altitude / (H × 0.25))`
- **Прозрачность**: плавный fade по высоте от поверхности (непрозрачно) до края атмосферы (прозрачно)
- **Coord system**: world-space координаты с учётом floating origin; `planetCenter` uniform обновляется каждый кадр как `-cameraPos`
- **Cloud Layer**: не реализован (2D noise texture planned)

### Edge Cases
- Камера внутри атмосферы → корректное лимб-свечение во все стороны
- Камера снаружи → атмосфера прозрачна (altitude > H → fade = 0)
- Большая высота (> 200 km) → атмосфера не рендерится (fade ≈ 0)
- Floating origin: planetCenter синхронизирован со сдвигом worldGroup

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
- DirectionalLight с интенсивностью 1.5 × (0.3 + 0.7 × max(0, sun.y))
- AmbientLight с интенсивностью 0.2 + 0.4 × max(0, sun.y)
- Цвет DirectionalLight: #fff5e6 (тёплый белый)
- Цвет AmbientLight: #8899bb (голубоватый рассеянный свет)
- Вращается вокруг планеты по времени (полный оборот = 120 секунд демо-времени)
- Аксиальный наклон 23.5° (inclination = 0.41 rad)
- **Y-компонента направления постоянна** (sin(inclination)): при старте над северным полюсом солнце всегда выше горизонта (полярный день). Истинный день/ночь потребует изменения долготы.
- Солнечный диск: не реализован (sprite planned)

### Edge Cases
- Солнце за горизонтом → AmbientLight = 0.2, DirectionalLight = 0.45 (минимальные)
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

### Состав меша (scale = 0.006, 1 unit = 1 km → самолёт ~15 м длины, истребитель)
Ось Z — продольная (нос в −Z, хвост в +Z). Ось Y — вертикальная. Ось X — поперечная (крылья).
BoxGeometry параметры: (ширина X, высота Y, глубина Z) в единицах сцены (km).
Итоговые размеры = BoxGeometry × scale:

| Часть | BoxGeometry | После scale×0.006 | В метрах |
|-------|-----------|-----------------|---------|
| Фюзеляж | 0.3 × 0.3 × 2.5 | 0.0018 × 0.0018 × 0.015 | 1.8 × 1.8 × 15 |
| Нос | 0.2 × 0.2 × 0.25 | 0.0012 × 0.0012 × 0.0015 | 1.2 × 1.2 × 1.5 |
| Кабина | 0.15 × 0.08 × 0.35 | 0.0009 × 0.00048 × 0.0021 | 0.9 × 0.48 × 2.1 |
| Крылья | 1.5 × 0.015 × 0.08 | 0.009 × 0.00009 × 0.00048 | 9 × 0.09 × 0.48 |
| Хвост. стаб. | 0.5 × 0.015 × 0.06 | 0.003 × 0.00009 × 0.00036 | 3 × 0.09 × 0.36 |
| Киль | 0.03 × 0.35 × 0.06 | 0.00018 × 0.0021 × 0.00036 | 0.18 × 2.1 × 0.36 |

- Group.scale = (0.006, 0.006, 0.006)

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
| H | Шпаргалка |
| U | Атмосфера вкл/выкл |
