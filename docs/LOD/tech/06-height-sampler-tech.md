# Техническая спецификация — HeightSampler

## 1. Алгоритмы

### 1.1 3D Value Noise

```
hash3(ix, iy, iz, seed) → float ∈ [0, 1]
  h = seed
  h = (h * 16777619) ^ ix  // FNV-1a prime
  h = (h * 16777619) ^ iу
  h = (h * 16777619) ^ iz
  h = (h * 16777619) ^ seed
  h = (h ^ (h >>> 13)) * 0x5bd1e995
  h = h ^ (h >>> 15)
  return (h & 0x7fffff) / 0x7fffff

valueNoise3D(x, y, z, seed) → float ∈ [0, 1]
  ix = floor(x), iy = floor(y), iz = floor(z)
  fx = smoothstep(x - ix), fy = smoothstep(y - iy), fz = smoothstep(z - iz)
  // Trilinear interpolation 8 углов куба
  c000 = hash3(ix,   iy,   iz,   seed)
  c100 = hash3(ix+1, iy,   iz,   seed)
  c010 = hash3(ix,   iy+1, iz,   seed)
  c110 = hash3(ix+1, iy+1, iz,   seed)
  c001 = hash3(ix,   iy,   iz+1, seed)
  c101 = hash3(ix+1, iy,   iz+1, seed)
  c011 = hash3(ix,   iy+1, iz+1, seed)
  c111 = hash3(ix+1, iy+1, iz+1, seed)
  // lerp по x → 4 значения; lerp по y → 2 значения; lerp по z → 1
  return trilinear(c000..c111, fx, fy, fz)
```

`smoothstep(t) = t³(10 − 15t + 6t²)` — Hermite 5-го порядка для C² непрерывности производных шума.

### 1.2 FBM (Fractional Brownian Motion)

```
fbm(x, y, z, octaves, scale, seedOffset) → float ∈ [0, 1]
  value = 0, amplitude = 1, frequency = 1, maxValue = 0
  for i = 0 to octaves-1:
    sx = x / scale * frequency
    sy = y / scale * frequency
    sz = z / scale * frequency
    value += amplitude * valueNoise3D(sx, sy, sz, seed + seedOffset + i * 73)
    maxValue += amplitude
    amplitude *= gain        // default 0.5
    frequency *= lacunarity  // default 2.0
  return value / maxValue    // normalize to [0, 1]
```

Параметры по умолчанию: octaves=12, lacunarity=2.0, gain=0.5, scale=200.
Масштаб 200 означает характерный размер особенностей ~200 км (при радиусе планеты 6371 км).

### 1.3 Ridged Multifractal (Musgrave)

```
ridgedMultifractal(x, y, z, octaves, scale, seedOffset) → float ∈ [0, 1]
  value = 0, amplitude = 1, frequency = 1, weight = 1
  maxValue = 0
  for i = 0 to octaves-1:
    sx = x / scale * frequency
    sy = y / scale * frequency
    sz = z / scale * frequency
    n = valueNoise3D(sx, sy, sz, seed + seedOffset + i * 73 + 1000)
    signed = n * 2 - 1           // map [0,1] → [-1,1]
    ridge = 1 - abs(signed)      // fold peaks → ridges
    ridge = ridge * ridge * weight  // sharpen ridges, feedback from previous octave
    value += ridge * amplitude
    maxValue += amplitude
    weight = ridge                // feedback: rough areas get rougher
    amplitude *= gain
    frequency *= lacunarity
  return value / maxValue
```

Ridged дает острые хребты горных массивов в отличие от гладких холмов FBM.
Weight feedback: области с высоким ridge на грубых октавах получают усиление на мелких — создаёт характерный горный рельеф.

### 1.4 Mountain Mask (continental separation)

```
getMountainMask(x, y, z) → float ∈ [0, 1]
  // Крупномасштабное разделение континент/океан
  raw = fbm(x, y, z, octaves=3, scale=2000, seedOffset=2000)
  // Плавный переход через foothills
  return smoothstepEdge(0.2, 0.6, raw)
  // 0.0 → 0.2: океан (0% гор)
  // 0.2 → 0.6: предгорья (0→100% гор)
  // 0.6 → 1.0: континент (100% гор)
```

`smoothstepEdge(e0, e1, x)` = Hermite interpolation: 0 если x < e0, 1 если x > e1.

### 1.5 Domain Warp (biome boundary fractalization)

```
getBiomeWarp(x, y, z, octaves) → float ∈ [-1, 1]
  // Отдельный слой FBM на scale=500 для возмущения границ биомов
  return fbm(x, y, z, octaves, scale=500, seedOffset=3000) * 2 - 1
```

### 1.6 Main Terrain Sampling (getHeight)

```
getHeight(x, y, z) → float ∈ [0, 1]
  mask = getMountainMask(x, y, z)

  // Базовый рельеф: FBM (гладкие холмы/равнины)
  base = fbm(x, y, z, octaves=12, scale=200, seedOffset=0)

  // Горный рельеф: ridged multifractal (острые хребты)
  ridge = ridgedMultifractal(x, y, z, octaves=min(10, octaves), scale=200, seedOffset=1000)

  // Blend: base + небольшое усиление базовых холмов в горах +
  //        ridge с весом mask (горы только на континентах)
  result = base * (1 + mask * 0.2) + ridge * (mask * 0.3)
  return clamp(result, 0, 1)
```

Коэффициенты подобраны эмпирически:
- `base * (1 + mask * 0.2)` — континенты на 20% выше океанов
- `ridge * (mask * 0.3)` — горные хребты 30% вклада на континентах, 0% в океане

### 1.7 Sample Batch (для Worker transfer)

```
sampleBatch(points: Float32Array) → Float32Array
  // points: [x0, y0, z0, x1, y1, z1, ...] — N троек
  // returns: [h0, h1, ...] — N высот
  for i = 0 to points.length/3 - 1:
    result[i] = getHeight(points[i*3], points[i*3+1], points[i*3+2])
  return result
```

Batch-сэмплирование критично для производительности Worker-а: один transfer на чанк вместо (resolution+1)² отдельных вызовов.

## 2. Структуры данных

```ts
class HeightSampler {
  private seed: number;          // u32, детерминизм
  private octaves: number;       // u8, default 12
  private lacunarity: number;    // f32, default 2.0
  private gain: number;          // f32, default 0.5
  private scale: number;         // f32, default 200 (km)
}
```

Все поля `readonly` после конструктора. Объект не имеет изменяемого состояния — seed фиксирован на весь жизненный цикл. Это гарантирует детерминизм: `getHeight(x,y,z)` с одним seed всегда возвращает одно значение.

**Memory footprint:** ~32 байт на экземпляр (5 чисел + vtable).

## 3. Производительность

| Операция | Complexity | ~Time (одна точка) |
|----------|-----------|---------------------|
| `getHeight` | O(octaves × 8) | ~0.3 ms (12 octaves) |
| `getBiomeWarp` | O(octaves × 8) | ~0.2 ms (8 octaves) |
| `sampleBatch` | O(N × octaves × 8) | ~50 ms (res=16, 289 точек) |

- 12 октав FBM: 12 × 8 hash-вызовов = 96 hash на точку
- При resolution=16: (16+1)² = 289 вершин на чанк → ~14 ms (только FBM)
- Полный `getHeight` (FBM + ridged + mask): ~25 ms на чанк
- Для async dispatch: порог бюджета N(d) ≈ 8 ms (один кадр 16.6 ms минус overhead)

**Профилировочные точки:**
- `hash3` — доминирует (~60% времени)
- `valueNoise3D` trilinear interpolation (~25%)
- `fbm` loop overhead (~15%)

## 4. Интеграция с Babylon.js

Не используется. HeightSampler — чистая математика. Координаты передаются в мировом пространстве (x, y, z), результаты — нормализованные высоты [0, 1].

## 5. Обработка ошибок

| Условие | Поведение |
|---------|-----------|
| `seed = 0` | Допустимо (0 — валидный seed, даёт детерминированный рельеф) |
| `NaN/Infinity` координаты | `hash3` вернёт 0 (побитовые операции на NaN дают 0) |
| `octaves = 0` | `fbm` вернёт 0 (пустой цикл → value=0) |
| `scale = 0` | `x/scale → Infinity` → hash от Inf даёт 0 → результат 0 |
| `gain ≥ 1` | Не ошибка, но шум не затухает — высокие октавы доминируют |

## 6. Состояния

Единственное состояние — immutable после конструктора. Состояний времени выполнения нет.

```
  new HeightSampler(seed) → [ready] — неизменяем до dispose
```

Worker-прокси (`getWorkerProxy()`) создаёт копию HeightSampler внутри Worker-а с тем же seed и параметрами. Worker-экземпляр не разделяет состояние с главным потоком — каждый Worker имеет собственный HeightSampler.

## Ссылки

- Requirement spec: `docs/LOD/06-height-sampler.md`
- Используется: ChunkGenerator, AsyncJobScheduler (Worker proxy)
