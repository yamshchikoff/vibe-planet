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

---

## 2. PlanetGenerator (`src/planet/`)

### Responsibility
Генерирует процедурную планету: сферическую геометрию с шумовым смещением вершин и биомной раскраской.

### API

```ts
interface PlanetConfig {
  radius: number;        // радиус сферы (default: 10)
  segments: number;      // детализация сетки (default: 64)
  noiseOctaves: number;  // октавы фрактального шума (default: 6)
  noiseScale: number;    // масштаб шума (default: 2.0)
  heightAmplitude: number; // амплитуда смещения вершин (default: 1.5)
  seed: number;          // сид для воспроизводимости (default: random)
}

class PlanetGenerator {
  constructor(config?: Partial<PlanetConfig>)
  generate(): THREE.Mesh        // создаёт меш планеты
  getHeightAt(lat: number, lon: number): number  // высота в точке (для коллизий)
  regenerate(): void            // перегенерировать с новым сидом
  dispose(): void               // освободить GPU ресурсы
}
```

### Biome Mapping (by normalized height)

| Height Range | Biome | Color |
|-------------|-------|-------|
| < 0.0 | Water | #1a5276 |
| 0.0 – 0.05 | Sand/Beach | #d4a76a |
| 0.05 – 0.4 | Grass | #2e7d32 |
| 0.4 – 0.7 | Rock | #616a6b |
| 0.7 – 1.0 | Snow | #f0f0f0 |

### States
- **empty**: не было generate()
- **generated**: меш создан и в сцене
- **disposed**: ресурсы освобождены

### Edge Cases
- Сегментов < 4 → clamp к 4
- Нулевой радиус → fallback к 1
- Размер геометрии > 2M вершин → предупреждение в консоль
- getHeightAt вне диапазона широты/долготы → clamp

---

## 3. FlightModel (`src/flight/`)

### Responsibility
Упрощённая физика самолёта с фиксированным шагом обновления.

### Constants

```
GRAVITY = 9.8 (единиц/с²)
MAX_THRUST = 15 (единиц/с²)
DRAG_COEFF = 0.02
LIFT_COEFF = 0.08
THROTTLE_RATE = 2.0 (единиц/с)
ROTATION_RATE = 2.0 (рад/с)
PLANET_RADIUS = 10
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

### Collision
- Минимальная высота = `PLANET_RADIUS`
- При касании: vertical_speed обнуляется, position clamp. Горизонтальная скорость сохраняется.
- Начальное состояние: в воздухе, с крейсерской скоростью (<code>speed &gt; 0</code>)

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
Пост-обработка: скайбокс/атмосферное рассеяние, облачный слой.

### API

```ts
interface AtmosphereConfig {
  planetRadius: number;
  atmosphereHeight: number;  // default: radius * 0.1
}

class Atmosphere {
  constructor(config: AtmosphereConfig)
  getMesh(): THREE.Mesh           // сфера атмосферы
  update(cameraPos: THREE.Vector3): void  // обновление uniform-ов
  dispose(): void
}
```

### Cloud Layer
- Прозрачная сфера поверх планеты
- Шумовая текстура сферы как альфа-маска
- Медленное вращение (отдельное от планеты)

### Edge Cases
- Камера внутри атмосферы → корректный цвет неба
- Камера снаружи → прозрачная атмосфера

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
- Фюзеляж: Box (2.5 × 0.35 × 0.35), цвет #5a5a5a
- Нос: Box (0.3 × 0.25 × 0.25), цвет #4a4a4a
- Кабина: Box (0.4 × 0.12 × 0.2), цвет #88ccff
- Крылья основные: Box (0.08 × 0.04 × 4.0), цвет #6a6a6a
- Хвостовые стабилизаторы: Box (0.08 × 0.04 × 1.2), цвет #6a6a6a
- Киль (вертикальный): Box (0.08 × 0.6 × 0.3), цвет #5a5a5a
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
