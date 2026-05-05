import {
  SphereGeometry,
  Mesh,
  MeshStandardMaterial,
  Color,
  Vector3,
  BufferAttribute,
} from 'three';

export interface PlanetConfig {
  radius: number;
  segments: number;
  noiseOctaves: number;
  noiseScale: number;
  heightAmplitude: number;
  seed: number;
}

const DEFAULTS: PlanetConfig = {
  radius: 10,
  segments: 64,
  noiseOctaves: 6,
  noiseScale: 2.0,
  heightAmplitude: 1.5,
  seed: Math.random() * 1000,
};

// Simple deterministic pseudo-random number generator (mulberry32)
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Value noise for the planet
function generateNoiseMap(seed: number, width: number, height: number): number[][] {
  const rand = mulberry32(seed);
  const map: number[][] = [];
  for (let y = 0; y < height; y++) {
    map[y] = [];
    for (let x = 0; x < width; x++) {
      map[y][x] = rand();
    }
  }
  return map;
}

function smoothNoise(
  map: number[][],
  x: number,
  y: number,
  width: number,
  height: number
): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const x0 = ((xi % width) + width) % width;
  const x1 = ((xi + 1) % width + width) % width;
  const y0 = ((yi % height) + height) % height;
  const y1 = ((yi + 1) % height + height) % height;

  // Smooth step
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);

  const n00 = map[y0][x0];
  const n10 = map[y0][x1];
  const n01 = map[y1][x0];
  const n11 = map[y1][x1];

  const ix0 = n00 + (n10 - n00) * sx;
  const ix1 = n01 + (n11 - n01) * sx;

  return ix0 + (ix1 - ix0) * sy;
}

function fbm(
  map: number[][],
  x: number,
  y: number,
  octaves: number,
  width: number,
  height: number
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += amplitude * smoothNoise(map, x * frequency, y * frequency, width, height);
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return value / maxValue;
}

// Map lat/lon to (u, v) for noise sampling
function latLonToUV(lat: number, lon: number): [number, number] {
  // lat: -PI/2 to PI/2 mapped to 0..1
  // lon: -PI to PI mapped to 0..1
  const u = ((lon / Math.PI + 1) / 2) % 1;
  const v = (lat / Math.PI + 0.5) % 1;
  return [u, v];
}

const BIOMES: { threshold: number; color: string }[] = [
  { threshold: 0.0, color: '#1a5276' },   // deep water
  { threshold: 0.08, color: '#2980b9' },   // shallow water
  { threshold: 0.12, color: '#d4a76a' },   // sand
  { threshold: 0.2, color: '#6b8e23' },    // grass
  { threshold: 0.5, color: '#556b2f' },    // forest
  { threshold: 0.7, color: '#616a6b' },    // rock
  { threshold: 0.85, color: '#f0f0f0' },   // snow
];

function getBiomeColor(height: number): Color {
  for (const biome of BIOMES) {
    if (height < biome.threshold) {
      return new Color(biome.color);
    }
  }
  return new Color(BIOMES[BIOMES.length - 1].color);
}

export class PlanetGenerator {
  private config: PlanetConfig;
  private mesh: Mesh | null = null;
  private noiseMap: number[][] | null = null;

  constructor(config?: Partial<PlanetConfig>) {
    this.config = { ...DEFAULTS, ...config };
    this.config.segments = Math.max(4, this.config.segments);
    this.config.radius = Math.max(1, this.config.radius);
  }

  generate(): Mesh {
    const { radius, segments, noiseOctaves, noiseScale, heightAmplitude, seed } = this.config;
    const noiseSize = segments * 2;

    // Generate noise texture
    this.noiseMap = generateNoiseMap(seed, noiseSize, noiseSize);

    // Create base sphere geometry
    const geometry = new SphereGeometry(radius, segments, segments);

    // Get existing attributes
    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const vertex = new Vector3();

    // Displace vertices and assign colors
    for (let i = 0; i < pos.count; i++) {
      vertex.fromBufferAttribute(pos, i);
      vertex.normalize();

      const lat = Math.asin(vertex.y / radius);
      const lon = Math.atan2(vertex.z, vertex.x);
      const [u, v] = latLonToUV(lat, lon);

      const noiseVal = this.noiseMap
        ? fbm(this.noiseMap, u * noiseScale * noiseSize, v * noiseScale * noiseSize, noiseOctaves, noiseSize, noiseSize)
        : 0;

      const heightOffset = (noiseVal - 0.5) * 2 * heightAmplitude;
      const displacedR = radius + Math.max(0, heightOffset); // only raise, don't lower below radius

      vertex.setLength(displacedR);
      pos.setXYZ(i, vertex.x, vertex.y, vertex.z);

      // Normalize height for biome mapping
      const normalizedH = (displacedR - radius) / heightAmplitude;
      const color = getBiomeColor(normalizedH);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      metalness: 0.1,
      flatShading: false,
    });

    this.mesh = new Mesh(geometry, material);
    this.mesh.userData['planetRadius'] = radius;
    this.mesh.userData['heightAmplitude'] = heightAmplitude;

    return this.mesh;
  }

  regenerate(): void {
    this.config.seed = Math.random() * 1000;
    this.noiseMap = null;
    this.mesh = null;
  }

  getHeightAt(lat: number, lon: number): number {
    const { radius, noiseOctaves, noiseScale, heightAmplitude } = this.config;
    if (!this.noiseMap) return radius;

    const noiseSize = this.config.segments * 2;
    const [u, v] = latLonToUV(lat, lon);

    const noiseVal = fbm(
      this.noiseMap,
      ((u % 1) + 1) % 1 * noiseScale * noiseSize,
      ((v % 1) + 1) % 1 * noiseScale * noiseSize,
      noiseOctaves,
      noiseSize,
      noiseSize
    );

    const heightOffset = (noiseVal - 0.5) * 2 * heightAmplitude;
    return radius + Math.max(0, heightOffset);
  }

  dispose(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      if (Array.isArray(this.mesh.material)) {
        this.mesh.material.forEach((m) => m.dispose());
      } else {
        this.mesh.material.dispose();
      }
      this.mesh = null;
    }
    this.noiseMap = null;
  }
}
