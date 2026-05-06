import {
  Mesh,
  VertexData,
  PBRMaterial,
  TransformNode,
  Vector3,
  type Scene,
} from '@babylonjs/core';
import { HeightSampler } from './HeightSampler';

export interface LODConfig {
  planetRadius: number;
  seed: number;
  heightAmplitude: number;
  maxDepth: number;
  maxChunks: number;
  chunkResolution: number;
  biomeWarpAmplitude: number;
}

const DEFAULTS: Required<LODConfig> = {
  planetRadius: 6371,
  seed: Math.random() * 2147483647,
  heightAmplitude: 8,
  maxDepth: 12,
  maxChunks: 1000,
  chunkResolution: 16,
  biomeWarpAmplitude: 0.035,
};

const FACES: { axis: number; sign: number }[] = [
  { axis: 0, sign: 1 },
  { axis: 0, sign: -1 },
  { axis: 1, sign: 1 },
  { axis: 1, sign: -1 },
  { axis: 2, sign: 1 },
  { axis: 2, sign: -1 },
];

const FACE_NORMALS = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];

const FACE_WINDING_FLIP = [false, true, true, false, false, true];

const _tmpVec = new Vector3();

type ChunkCacheEntry = {
  mesh: Mesh;
  lastAccess: number;
};

function uvToDir(faceIdx: number, u: number, v: number): Vector3 {
  const { axis, sign } = FACES[faceIdx];
  const coords = [u, v];
  let ci = 0;
  const out = new Vector3();
  for (let i = 0; i < 3; i++) {
    const val = i === axis ? sign : coords[ci++];
    if (i === 0) out.x = val;
    else if (i === 1) out.y = val;
    else out.z = val;
  }
  return out;
}

function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function getBiomeColor(normalizedHeight: number, lat: number): [number, number, number] {
  const h = Math.max(0, Math.min(1, normalizedHeight));

  const snowThreshold = Math.max(
    0.25,
    0.85 - Math.max(0, Math.abs(lat) - Math.PI / 3) * 0.8
  );

  const snowColor: [number, number, number] = [0.941, 0.941, 0.941];

  let thresholds: number[];
  let colors: [number, number, number][];

  if (snowThreshold <= 0.3) {
    thresholds = [0, 0.1, 0.25, snowThreshold];
    colors = [
      [0.102, 0.239, 0.420],
      [0.157, 0.502, 0.725],
      [0.831, 0.655, 0.416],
      snowColor,
    ];
  } else if (snowThreshold <= 0.55) {
    thresholds = [0, 0.1, 0.25, 0.3, snowThreshold];
    colors = [
      [0.102, 0.239, 0.420],
      [0.157, 0.502, 0.725],
      [0.831, 0.655, 0.416],
      [0.290, 0.549, 0.247],
      snowColor,
    ];
  } else if (snowThreshold <= 0.7) {
    thresholds = [0, 0.1, 0.25, 0.3, 0.55, snowThreshold];
    colors = [
      [0.102, 0.239, 0.420],
      [0.157, 0.502, 0.725],
      [0.831, 0.655, 0.416],
      [0.290, 0.549, 0.247],
      [0.176, 0.353, 0.153],
      snowColor,
    ];
  } else {
    thresholds = [0, 0.1, 0.25, 0.3, 0.55, 0.7, snowThreshold];
    colors = [
      [0.102, 0.239, 0.420],
      [0.157, 0.502, 0.725],
      [0.831, 0.655, 0.416],
      [0.290, 0.549, 0.247],
      [0.176, 0.353, 0.153],
      [0.478, 0.478, 0.478],
      snowColor,
    ];
  }

  for (let i = 0; i < thresholds.length - 1; i++) {
    if (h >= thresholds[i] && h < thresholds[i + 1]) {
      const range = thresholds[i + 1] - thresholds[i];
      if (range < 1e-6) return colors[i];
      const t = (h - thresholds[i]) / range;
      const s = t * t * (3 - 2 * t);
      return lerpColor(colors[i], colors[i + 1], s);
    }
  }

  return snowColor;
}

function getBiomePBR(normalizedHeight: number, lat: number): [number, number] {
  const h = Math.max(0, Math.min(1, normalizedHeight));
  const snowThreshold = Math.max(
    0.25,
    0.85 - Math.max(0, Math.abs(lat) - Math.PI / 3) * 0.8
  );

  if (h < 0.1) return [0.05, 0.00];
  if (h < 0.25) return [0.20, 0.00];
  if (h < 0.3) return [0.90, 0.00];
  if (h < 0.55) return [0.80, 0.00];
  if (h < 0.7) return [0.70, 0.00];
  if (h < snowThreshold) {
    const t = Math.max(0, Math.min(1, (h - 0.7) / (snowThreshold - 0.7)));
    const s = t * t * (3 - 2 * t);
    return [0.55 + (0.45 - 0.55) * s, 0.05 + (0.10 - 0.05) * s];
  }
  return [0.95, 0.00];
}

export class LODPlanet {
  private config: Required<LODConfig>;
  private sampler: HeightSampler;
  private cache: Map<string, ChunkCacheEntry> = new Map();
  private scene: Scene;
  private root: TransformNode;
  private activeMeshes: Set<string> = new Set();

  constructor(config?: Partial<LODConfig>, scene?: Scene) {
    this.config = { ...DEFAULTS, ...config };
    this.sampler = new HeightSampler(this.config.seed);
    this.scene = scene!;
    this.root = scene ? new TransformNode('planetRoot', scene) : null!;
  }

  getRoot(): TransformNode {
    if (!this.root) {
      this.root = new TransformNode('planetRoot', this.scene);
    }
    return this.root;
  }

  getHeightAt(worldPos: Vector3): number {
    return this.sampler.getHeight(worldPos.x, worldPos.y, worldPos.z);
  }

  update(cameraPos: Vector3): void {
    if (!this.scene) return;
    const now = performance.now();
    const R = this.config.planetRadius;
    const maxDepth = this.config.maxDepth;
    const distFromCenter = cameraPos.length();
    const distFromSurface = Math.max(0, distFromCenter - R);
    const heightAmp = this.config.heightAmplitude;

    let effectiveDepth = maxDepth;
    if (distFromSurface > 0) {
      const levels = Math.floor(Math.log2(distFromSurface / 5 + 1));
      effectiveDepth = Math.max(0, maxDepth - levels);
    }

    const needed: { faceIdx: number; depth: number; tx: number; ty: number }[] = [];

    for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
      const camDir = _tmpVec.copyFrom(cameraPos).normalize();
      const dot = camDir.dot(FACE_NORMALS[faceIdx]);
      if (dot < -0.2) continue;

      this.traverseFace(faceIdx, cameraPos, effectiveDepth, 0, 0, 0, needed);
    }

    const neededSet = new Set<string>();
    const newActive = new Set<string>();

    for (const node of needed) {
      const key = this.chunkKey(node.faceIdx, node.depth, node.tx, node.ty);
      neededSet.add(key);

      if (this.cache.has(key)) {
        const entry = this.cache.get(key)!;
        entry.lastAccess = now;
        if (!entry.mesh.isEnabled()) {
          entry.mesh.setEnabled(true);
        }
        newActive.add(key);
      } else {
        if (this.cache.size >= this.config.maxChunks) {
          this.evictOldest(neededSet);
        }
        const mesh = this.generateChunk(node.faceIdx, node.depth, node.tx, node.ty, R, heightAmp);
        if (mesh) {
          mesh.setParent(this.root);
          this.cache.set(key, { mesh, lastAccess: now });
          newActive.add(key);
        }
      }
    }

    // Hide chunks no longer needed
    for (const key of this.activeMeshes) {
      if (!newActive.has(key)) {
        const entry = this.cache.get(key);
        if (entry) entry.mesh.setEnabled(false);
      }
    }
    this.activeMeshes = newActive;
  }

  private traverseFace(
    faceIdx: number,
    cameraPos: Vector3,
    maxDepth: number,
    depth: number,
    tx: number,
    ty: number,
    out: { faceIdx: number; depth: number; tx: number; ty: number }[]
  ): void {
    const R = this.config.planetRadius;
    const size = 1 / (1 << depth);
    const cu = (tx + 0.5) * size * 2 - 1;
    const cv = (ty + 0.5) * size * 2 - 1;

    const centerDir = uvToDir(faceIdx, cu, cv).normalize();
    const surfacePos = _tmpVec.copyFrom(centerDir).scale(R);
    const dist = Vector3.Distance(cameraPos, surfacePos);
    const chunkWorldSize = (2 * Math.PI * R) / (4 * (1 << depth));

    const shouldSplit = depth < maxDepth && dist < chunkWorldSize * 3;

    if (shouldSplit) {
      const childDepth = depth + 1;
      const childTx = tx * 2;
      const childTy = ty * 2;
      this.traverseFace(faceIdx, cameraPos, maxDepth, childDepth, childTx, childTy, out);
      this.traverseFace(faceIdx, cameraPos, maxDepth, childDepth, childTx + 1, childTy, out);
      this.traverseFace(faceIdx, cameraPos, maxDepth, childDepth, childTx, childTy + 1, out);
      this.traverseFace(faceIdx, cameraPos, maxDepth, childDepth, childTx + 1, childTy + 1, out);
    } else {
      out.push({ faceIdx, depth, tx, ty });
    }
  }

  private generateChunk(
    faceIdx: number,
    depth: number,
    tx: number,
    ty: number,
    R: number,
    heightAmp: number
  ): Mesh | null {
    const res = this.config.chunkResolution;
    const verts = res + 1;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];

    const step = 1 / (1 << depth);
    const u0 = tx * step * 2 - 1;
    const v0 = ty * step * 2 - 1;
    const du = step * 2 / res;
    const dv = step * 2 / res;

    // Pre-allocate height grid for normal computation
    const heightGrid: number[][] = [];
    for (let j = 0; j < verts; j++) {
      heightGrid[j] = [];
      for (let i = 0; i < verts; i++) {
        const u = u0 + i * du;
        const v = v0 + j * dv;
        const dir = uvToDir(faceIdx, u, v);
        const samplePos = _tmpVec.copyFrom(dir).scale(R);
        const h = this.sampler.getHeight(samplePos.x, samplePos.y, samplePos.z);
        heightGrid[j][i] = h;
      }
    }

    // Aggregate PBR for uniform material
    let totalRoughness = 0;
    let totalMetallic = 0;

    for (let j = 0; j < verts; j++) {
      for (let i = 0; i < verts; i++) {
        const u = u0 + i * du;
        const v = v0 + j * dv;
        const h = heightGrid[j][i];

        const dir = uvToDir(faceIdx, u, v).normalize();
        const altitude = h * heightAmp;
        positions.push(dir.x * (R + altitude), dir.y * (R + altitude), dir.z * (R + altitude));

        // Normal via central differences
        const duv = 1 / res * step * 2;
        const hu1 = i + 1 < verts ? heightGrid[j][i + 1] : h;
        const hu2 = i - 1 >= 0 ? heightGrid[j][i - 1] : h;
        const hv1 = j + 1 < verts ? heightGrid[j + 1][i] : h;
        const hv2 = j - 1 >= 0 ? heightGrid[j - 1][i] : h;

        const dhdu = (hu1 - hu2) / (2 * duv);
        const dhdv = (hv1 - hv2) / (2 * duv);

        const dirU = uvToDirTangent(faceIdx, u, v, 'u').normalize();
        const dirV = uvToDirTangent(faceIdx, u, v, 'v').normalize();
        const nx = dir.x - dhdu * dirU.x - dhdv * dirV.x;
        const ny = dir.y - dhdu * dirU.y - dhdv * dirV.y;
        const nz = dir.z - dhdu * dirU.z - dhdv * dirV.z;
        const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (nlen > 1e-10) {
          normals.push(nx / nlen, ny / nlen, nz / nlen);
        } else {
          normals.push(dir.x, dir.y, dir.z);
        }

        // Biome color with fractal domain warp (RGBA for Babylon.js)
        const warpOctaves = Math.min(6, depth + 2);
        const warp = this.sampler.getBiomeWarp(dir.x, dir.y, dir.z, warpOctaves);
        const warpedH = h + warp * this.config.biomeWarpAmplitude;
        const lat = Math.asin(Math.max(-1, Math.min(1, dir.y)));
        const [cr, cg, cb] = getBiomeColor(warpedH, lat);
        colors.push(cr, cg, cb, 1);

        // Aggregate PBR values for uniform material
        const [r, m] = getBiomePBR(warpedH, lat);
        totalRoughness += r;
        totalMetallic += m;
      }
    }

    // Indices
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const a = j * verts + i;
        const b = j * verts + i + 1;
        const c = (j + 1) * verts + i;
        const d = (j + 1) * verts + i + 1;
        if (FACE_WINDING_FLIP[faceIdx]) {
          indices.push(a, c, b, c, d, b);
        } else {
          indices.push(a, b, c, b, d, c);
        }
      }
    }

    const vertexCount = verts * verts;

    // Create Babylon.js mesh with VertexData
    const mesh = new Mesh(`chunk-f${faceIdx}-d${depth}-${tx}-${ty}`, this.scene);

    const vertexData = new VertexData();
    vertexData.positions = new Float32Array(positions);
    vertexData.normals = new Float32Array(normals);
    vertexData.colors = new Float32Array(colors);
    vertexData.indices = new Uint32Array(indices);
    vertexData.applyToMesh(mesh, true);

    const mat = new PBRMaterial(`mat-${faceIdx}-${depth}-${tx}-${ty}`, this.scene);
    mat.roughness = totalRoughness / vertexCount;
    mat.metallic = totalMetallic / vertexCount;
    mat.clearCoat.isEnabled = true;
    mat.clearCoat.intensity = 0.04;

    mat.useVertexColor = true;
    mesh.material = mat;
    mesh.receiveShadows = true;

    return mesh;
  }

  private evictOldest(neededSet: Set<string>): void {
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [key, entry] of this.cache) {
      if (!neededSet.has(key) && entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      const entry = this.cache.get(oldestKey)!;
      entry.mesh.dispose();
      this.cache.delete(oldestKey);
    }
  }

  private chunkKey(faceIdx: number, depth: number, tx: number, ty: number): string {
    return `f${faceIdx}-d${depth}-${tx}-${ty}`;
  }

  dispose(): void {
    for (const [, entry] of this.cache) {
      entry.mesh.dispose();
    }
    this.cache.clear();
    this.activeMeshes.clear();
  }
}

function uvToDirTangent(faceIdx: number, u: number, v: number, dir: 'u' | 'v'): Vector3 {
  const eps = 0.001;
  if (dir === 'u') {
    return uvToDir(faceIdx, u + eps, v).normalize().subtract(uvToDir(faceIdx, u - eps, v).normalize());
  }
  return uvToDir(faceIdx, u, v + eps).normalize().subtract(uvToDir(faceIdx, u, v - eps).normalize());
}
