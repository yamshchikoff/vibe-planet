// 3D seeded value noise with FBM for planetary terrain height sampling.
// Deterministic per seed: same seed + same coordinates → same height.
// Input coordinates are in km (planet-space).
// Output is normalized height in [0, 1].
//
// Terrain model:
//   - Large-scale mountain mask separates "mountain zones" from "flat zones"
//   - In mountain zones: ridged multi-fractal noise → sharp ridges, V-valleys
//   - In flat zones: standard FBM → rolling hills, plains
//   - Smooth transition at zone boundaries

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 1274126177 + seed * 1013904223) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  h = ((h ^ (h >> 15)) * 16807) | 0;
  return ((h & 0x7fffffff) / 0x7fffffff);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function smoothstepEdge(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function valueNoise3D(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const sx = smoothstep(fx);
  const sy = smoothstep(fy);
  const sz = smoothstep(fz);

  const n000 = hash3(ix, iy, iz, seed);
  const n100 = hash3(ix + 1, iy, iz, seed);
  const n010 = hash3(ix, iy + 1, iz, seed);
  const n110 = hash3(ix + 1, iy + 1, iz, seed);
  const n001 = hash3(ix, iy, iz + 1, seed);
  const n101 = hash3(ix + 1, iy, iz + 1, seed);
  const n011 = hash3(ix, iy + 1, iz + 1, seed);
  const n111 = hash3(ix + 1, iy + 1, iz + 1, seed);

  const nx00 = lerp(n000, n100, sx);
  const nx10 = lerp(n010, n110, sx);
  const nx01 = lerp(n001, n101, sx);
  const nx11 = lerp(n011, n111, sx);
  const nxy0 = lerp(nx00, nx10, sy);
  const nxy1 = lerp(nx01, nx11, sy);
  return lerp(nxy0, nxy1, sz);
}

export class HeightSampler {
  private seed: number;
  private octaves: number;
  private lacunarity: number;
  private gain: number;
  private scale: number;

  constructor(
    seed: number,
    octaves = 12,
    lacunarity = 2.0,
    gain = 0.5,
    scale = 200
  ) {
    this.seed = seed;
    this.octaves = octaves;
    this.lacunarity = lacunarity;
    this.gain = gain;
    this.scale = scale;
  }

  /** Standard FBM in [0, 1] */
  private fbm(
    x: number, y: number, z: number,
    octaves: number, scale: number, seedOffset: number
  ): number {
    let amplitude = this.gain;
    let frequency = 1 / scale;
    let value = 0;
    let maxVal = 0;

    for (let i = 0; i < octaves; i++) {
      value += valueNoise3D(
        x * frequency, y * frequency, z * frequency,
        this.seed + seedOffset + i * 137
      ) * amplitude;
      maxVal += amplitude;
      frequency *= this.lacunarity;
      amplitude *= this.gain;
    }

    return value / maxVal;
  }

  /** Ridged multi-fractal noise in [0, 1] — sharp V-shaped ridges and valleys */
  private ridgedFbm(
    x: number, y: number, z: number,
    octaves: number, scale: number, seedOffset: number
  ): number {
    let amplitude = this.gain;
    let frequency = 1 / scale;
    let value = 0;
    let maxVal = 0;

    for (let i = 0; i < octaves; i++) {
      const n = valueNoise3D(
        x * frequency, y * frequency, z * frequency,
        this.seed + seedOffset + i * 137
      );
      // Ridge: 1 at noise zero-crossings, 0 at noise extremes (±1)
      const ridge = 1 - Math.abs(n);
      // Square to sharpen: narrow peaks, broad valleys
      value += ridge * ridge * amplitude;
      maxVal += amplitude;
      frequency *= this.lacunarity;
      amplitude *= this.gain;
    }

    return value / maxVal;
  }

  /** Mountain mask in [0, 1] — continental-scale separation of flat and mountain zones */
  getMountainMask(x: number, y: number, z: number): number {
    const maskScale = 2000;
    const maskOctaves = 3;
    const raw = this.fbm(x, y, z, maskOctaves, maskScale, 3000);
    // Push toward 0 (flat) or 1 (mountain) with smooth transition
    return smoothstepEdge(0.25, 0.55, raw);
  }

  getHeight(x: number, y: number, z: number): number {
    // Large-scale mountain mask
    const mask = this.getMountainMask(x, y, z);

    // Smooth base terrain (rolling hills, plains) — same octaves
    const base = this.fbm(x, y, z, this.octaves, this.scale, 0);

    // Sharp ridged mountains — use slightly fewer octaves (ridge noise naturally
    // contains more high-frequency energy per octave)
    const ridgeOctaves = Math.min(10, this.octaves);
    const ridge = this.ridgedFbm(x, y, z, ridgeOctaves, this.scale, 2000);

    // Blend between flat and mountain terrain
    // In flat zones: smooth base terrain
    // In mountain zones: base terrain + ridged detail on top (mountains are higher AND sharper)
    return Math.min(1, base + ridge * mask * 0.3);
  }

  // Domain warp for fractal biome boundaries.
  // Returns value in [-1, 1] at a scale larger than terrain height noise
  // so that biome boundary isolines become fractal curves.
  getBiomeWarp(x: number, y: number, z: number, octaves: number): number {
    const scale = 500;
    let amplitude = this.gain;
    let frequency = 1 / scale;
    let value = 0;
    let maxVal = 0;

    for (let i = 0; i < octaves; i++) {
      const nx = x * frequency;
      const ny = y * frequency;
      const nz = z * frequency;
      value += valueNoise3D(nx, ny, nz, this.seed + 1000 + i * 73) * amplitude;
      maxVal += amplitude;
      frequency *= this.lacunarity;
      amplitude *= this.gain;
    }

    return value / maxVal;
  }

  // Convenience: sample at spherical coordinates
  getHeightLatLon(lat: number, lon: number): number {
    const x = Math.cos(lat) * Math.cos(lon);
    const y = Math.sin(lat);
    const z = Math.cos(lat) * Math.sin(lon);
    return this.getHeight(x, y, z);
  }
}
