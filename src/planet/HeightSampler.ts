// 3D seeded value noise with FBM for planetary terrain height sampling.
// Deterministic per seed: same seed + same coordinates → same height.
// Input coordinates are in km (planet-space).
// Output is normalized height in [0, 1].

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 1274126177 + seed * 1013904223) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  h = ((h ^ (h >> 15)) * 16807) | 0;
  return ((h & 0x7fffffff) / 0x7fffffff);
}

function smoothstep(t: number): number {
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
    octaves = 6,
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

  getHeight(x: number, y: number, z: number): number {
    let amplitude = this.gain;
    let frequency = 1 / this.scale;
    let value = 0;
    let maxVal = 0;

    for (let i = 0; i < this.octaves; i++) {
      const nx = x * frequency;
      const ny = y * frequency;
      const nz = z * frequency;
      // Use a different seed offset per octave for variety
      value += valueNoise3D(nx, ny, nz, this.seed + i * 137) * amplitude;
      maxVal += amplitude;
      frequency *= this.lacunarity;
      amplitude *= this.gain;
    }

    // Normalize to [0, 1]
    return value / maxVal;
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
