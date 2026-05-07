# Module Specifications

**License:** MIT. See [LICENSE](../LICENSE) in repository root.
All implementation must be checked for compliance with the MIT License terms before distribution.

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

### Tone Mapping
- `ACESFilmicToneMapping` — кинематографичный highlight roll-off, насыщенные тени
- `toneMappingExposure = 1.0`
- `outputColorSpace = SRGBColorSpace`
- `scene.background = #050510` — тёмный navy, не чёрный космос

### Shadow Mapping
- `shadowMap.enabled = true` с `PCFSoftShadowMap`
- DirectionalLight: 2048×2048, bias -0.001, orthographic frustum ±200 km
- Planet chunks: receiveShadow все, castShadow на depth ≥ 6 (только ближние)
- Plane: cast + receive shadows
- Sprite солнца: `depthTest: true` — не просвечивает сквозь планету
- Atmosphere: не отбрасывает и не принимает тени (transparent BackSide)

### Edge Cases
- Canvas нулевого размера → ресайз при старте
- Окно меняет размер → слушатель `window.resize`, обновление камеры и рендерера
- Потеря WebGL контекста → авто-восстановление (Three.js default handler)
- Первый кадр: коллбэки onUpdate вызываются сразу (lastTime инициализируется при старте, а не в первом loop)
- Большая сцена (радиус планеты 6371): WebGLRenderer включает logarithmicDepthBuffer
- Дальняя плоскость камеры: 2000000 (для рендера солнечного диска на расстоянии 500000 km)



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
- FBM 12 октав с затуханием 0.5 (базовый ландшафт: холмы, равнины)
- **Musgrave ridged multifractal** для гор: noise в [-1, 1], V-образные гребни (`ridge = (1-|n|)²`), **weight feedback** — горные участки получают больше детализации на высоких частотах, равнины остаются гладкими
- Mountain mask (FBM 3 октавы, scale 2000 км) разделяет равнины и горные зоны с плавным переходом (smoothstep 0.20–0.60) — зона предгорий
- Финальная высота: `base × (1 + mask × 0.2) + ridge × mask × 0.3` — в горах базовый рельеф приподнимается, ridge добавляет резкость
- Высота нормализована в [0, 1], затем scaled к terrain amplitude
- Минимальная длина волны: 200 / 2¹¹ ≈ 100 м (фрактальная деталь до ~100 м)
- Детерминированна: seed + координаты → всегда тот же результат
- Бесшовна: 3D noise не имеет UV-швов
- Координаты в km (планета-пространство): LODPlanet передаёт position × R

### Per-Vertex PBR

Каждая вершина несёт roughness и metalness, соответствующие биому:

| Biome | Roughness | Metalness |
|-------|-----------|-----------|
| Deep Water | 0.05 | 0.00 |
| Shallow Water | 0.20 | 0.00 |
| Sand/Beach | 0.90 | 0.00 |
| Grassland | 0.80 | 0.00 |
| Forest | 0.70 | 0.00 |
| Rock → High Stone | 0.55 → 0.45 | 0.05 → 0.10 |
| Snow | 0.95 | 0.00 |

- `MeshPhysicalMaterial` с `clearcoat: 0.04`
- `BufferAttribute('pbr', Float32Array, 2)` на геометрии чанка
- `onBeforeCompile` патчит `roughnessFactor` и `metalnessFactor` на кастомные varyings
- Плавная интерполяция между биомами (smoothstep, те же thresholds что и для цвета)

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
Плавно управляемая камера-платформа с моделькой самолёта для визуализации.
Никакой физики — только кинематическое управление ориентацией и положением.
Крейсерская скорость: 2 km/s по умолчанию, меняется клавишами [ / ] по лог-шкале 0.125–64 km/s.

### Constants

```
SPEED_CRUISE = 2.0   (km/с)  — крейсерская скорость по умолчанию
SPEED_STEPS = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64]  — лог-шкала (×2 на шаг)
THROTTLE_RATE = 4.0           — разгон 0→1 за ~0.25 с
ROLL_RATE = 1.5       (рад/с)
PITCH_RATE = 0.8      (рад/с)
YAW_RATE = 1.0        (рад/с)
PLANET_RADIUS = 6371
START_ALTITUDE = 2    (km)
```

### Orientation Model (quaternion)

Ориентация платформы хранится как `THREE.Quaternion`. Управление:

- **Roll (A/D)** — вращение вокруг **локальной** оси Z (right-multiply: `q = q * q_roll`)
- **Pitch (W/S)** — вращение вокруг **локальной** оси X (right-multiply: `q = q * q_pitch`)
- **Yaw (Q/E)** — вращение вокруг **мировой** оси Y (left-multiply: `q = q_yaw * q`)

Никакой координированной связи крен-рыскание.

### Movement

Платформа движется строго вдоль продольной оси (forward):

```
forward = (0, 0, -1) × q                     // мир. система
throttleInput = sign(input.throttle)         // -1, 0, +1
throttle плавно подтягивается к throttleInput: ramp rate = 4.0

speed = throttle × SPEED_CRUISE
position += forward × speed × dt
velocity = forward × speed
```

При отпускании газа (throttle=0) скорость плавно падает до 0.
При Ctrl (throttle=-1) скорость плавно растёт до −cruiseSpeed km/s (задний ход).

### Collision
- Радиальная дистанция от центра планеты — при касании position clamp к сфере
- Без потери скорости (нет damping)

### API

```ts
class FlightModel {
  constructor(planetRadius?: number, spawnPosition?: [number, number, number])
  getState(): FlightState
  applyControls(input: ControlInput): void
  update(dt: number): void
  reset(): void
  setSpawn(position: [number, number, number]): void
  changeSpeed(direction: -1 | 1): void  // ×2 или ÷2 по лог-шкале
}
```

### FlightState

```ts
interface FlightState {
  position: [number, number, number];
  velocity: [number, number, number];
  orientation: { yaw: number; pitch: number; roll: number }; // из кватерниона, Euler XYZ
  throttle: number;    // -1..1
  speed: number;       // 0..2
}
```

### Initial State
- Position: спавн-позиция (north pole `[0, R+2, 0]` или mountain `[5993.87, 2181.71, 0]`)
- Velocity: `[0, 0, 0]` — нет движения без газа
- Orientation: выравнивание по поверхности через `alignToSurface()`
- Throttle: 0
- Speed: 0

### States
- **idle**: создан, throttle=0, не движется
- **moving**: throttle ≠ 0, движется в направлении носа (или хвоста при reverse)

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
| ] | speed up | — | ×2 крейсерская скорость |
| [ | speed down | — | ÷2 крейсерская скорость |

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

## 5. Atmosphere (`src/atmosphere/`) — DEFERRED

**Реализация отложена до завершения ландшафта и освещения.**

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
Солнечное освещение сцены. DirectionalLight + HemisphereLight + видимый диск солнца + shadow mapping.

### API

```ts
interface SunConfig {
  inclination: number;  // угол к оси планеты (default: 0.41 ≈ 23.5°)
  longitude: number;    // долгота, default: 0
}

class Sun {
  constructor(config?: Partial<SunConfig>)
  getLight(): THREE.DirectionalLight     // свет для сцены
  getHemisphere(): THREE.HemisphereLight // полусферическое освещение
  getSunSprite(): THREE.Sprite           // видимый диск солнца
  getDirection(): THREE.Vector3          // направление на солнце (world)
  update(time: number): void             // вращение по времени
  dispose(): void
}
```

### Поведение
- DirectionalLight с интенсивностью 1.5 × (0.3 + 0.7 × max(0, sun.y))
- Цвет DirectionalLight: #fff5e6 (тёплый белый)
- **HemisphereLight** заменяет AmbientLight:
  - skyColor: #87CEEB (голубой) → плавно к #FF8844 на закате
  - groundColor: #3B2F2F (тёмный) → плавно к #1a1a2e ночью
  - intensity: 0.40 в зените → 0.12 ночью
- **Visible Sun Disc**: THREE.Sprite с процедурным радиальным градиентом
  - AdditiveBlending, depthTest: false
  - Размер 12000 × 12000 на расстоянии 500000 km
  - В корне сцены (не worldGroup)
- Вращается вокруг планеты по времени (полный оборот = 120 секунд демо-времени)
- Аксиальный наклон 23.5° (inclination = 0.41 rad)
- **Y-компонента направления постоянна** (sin(inclination)): при старте над северным полюсом солнце всегда выше горизонта (полярный день). Истинный день/ночь потребует изменения долготы.

### Edge Cases
- Солнце за горизонтом → DirectionalLight = 0.45 (минимум), HemisphereLight = 0.12
- Переход день/ночь → плавная интерполяция интенсивности и цвета неба

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
| ] | Скорость ×2 |
| [ | Скорость ÷2 |

---

## 8. ChaseCamera (`src/camera/`)

### Responsibility
Плавное следование камеры за самолётом от третьего лица.

### Behaviour
- Камера удерживается на смещении в локальной системе самолёта (выше и позади)
- Позиция интерполируется `lerp` с конфигурируемой скоростью
- `lookAt` нацелен на позицию самолёта
- Работает с плавающим началом координат (floating origin)

### API

```ts
interface CameraConfig {
  offset: [number, number, number]; // локальное смещение (высота, ...), default: [0, 0.006, 0.015]
  lerpSpeed: number;                // 0..1, скорость сглаживания, default: 0.3
}

class ChaseCamera {
  constructor(config?: Partial<CameraConfig>)
  update(targetPos: THREE.Vector3, targetQuat: THREE.Quaternion, dt: number): void
  setCamera(cam: THREE.PerspectiveCamera): void
  setOffset(offset: [number, number, number]): void
  reset(): void
}
```

### Follow Behaviour
- `lerpSpeed = 0.3`: мягкое следование, камера «плавает» за самолётом
- Первый кадр: мгновенный прыжок на целевую позицию (нет разгона от (0,0,0))
- `lookAt` обновляется каждый кадр на реальную позицию самолёта (не сглаженно)

### Edge Cases
- Первый кадр после создания: jump на целевую позицию (без lerp)
- dt > 1/15 (падение FPS): clamp lerpFactor, чтобы не проскочить
