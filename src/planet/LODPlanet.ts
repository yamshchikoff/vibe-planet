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
  chunkResolution: number;
  biomeWarpAmplitude: number;
  /** Fixed base depth — generate all chunks once at this depth, no LOD. 0 = adaptive LOD. */
  baseDepth: number;
}

const DEFAULTS: Required<LODConfig> = {
  planetRadius: 6371,
  seed: Math.random() * 2147483647,
  heightAmplitude: 8,
  maxDepth: 12,
  chunkResolution: 16,
  biomeWarpAmplitude: 0.035,
  baseDepth: 0,
};

const FACES: { axis: number; sign: number }[] = [
  { axis: 0, sign: 1 },
  { axis: 0, sign: -1 },
  { axis: 1, sign: 1 },
  { axis: 1, sign: -1 },
  { axis: 2, sign: 1 },
  { axis: 2, sign: -1 },
];

// Faces 3 (-Y) and 4 (+Z) produce CW winding with the default vertex grid.
// Flipping the triangle indices corrects the winding for face culling.
const FACE_WINDING_FLIP = [false, true, true, false, false, true];

const _tmpVec = new Vector3();

type ChunkCacheEntry = {
  mesh: Mesh;
  lastAccess: number;
};

export function uvToDir(faceIdx: number, u: number, v: number): Vector3 {
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
  private generated = false;

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

  update(_cameraPos: Vector3): void {
    if (!this.scene || this.generated) return;
    this.generated = true;

    const R = this.config.planetRadius;
    const heightAmp = this.config.heightAmplitude;
    const depth = this.config.baseDepth;

    if (depth < 1) return;

    const now = performance.now();
    const numTiles = 1 << depth;

    for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
      for (let ty = 0; ty < numTiles; ty++) {
        for (let tx = 0; tx < numTiles; tx++) {
          const key = this.chunkKey(faceIdx, depth, tx, ty);
          const mesh = this.generateChunk(faceIdx, depth, tx, ty, R, heightAmp);
          if (mesh) {
            mesh.setParent(this.root);
            this.cache.set(key, { mesh, lastAccess: now });
          }
        }
      }
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

    // Pre-allocate height grid for normal computation.
    // Normalize dir to sample height ON the sphere (radius R), not on the cube
    // whose corners sit at R*sqrt(3) from center.
    const heightGrid: number[][] = [];
    for (let j = 0; j < verts; j++) {
      heightGrid[j] = [];
      for (let i = 0; i < verts; i++) {
        const u = u0 + i * du;
        const v = v0 + j * dv;
        const dir = uvToDir(faceIdx, u, v).normalize();
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
    mesh.useVertexColors = true;

    const mat = new PBRMaterial(`mat-${faceIdx}-${depth}-${tx}-${ty}`, this.scene);
    mat.sideOrientation = 0; // CCW — Babylon.js v9 left-handed scene defaults to CW
    mat.roughness = totalRoughness / vertexCount;
    mat.metallic = totalMetallic / vertexCount;
    mat.clearCoat.isEnabled = true;
    mat.clearCoat.intensity = 0.04;

    mesh.material = mat;
    mesh.receiveShadows = true;

    this._verifyChunk(mesh, faceIdx, depth, tx, ty, R, heightAmp);

    return mesh;
  }

  private chunkKey(faceIdx: number, depth: number, tx: number, ty: number): string {
    return `f${faceIdx}-d${depth}-${tx}-${ty}`;
  }

  private _verifyChunk(
    mesh: Mesh,
    faceIdx: number,
    depth: number,
    tx: number,
    ty: number,
    R: number,
    heightAmp: number,
  ): void {
    const pos = mesh.getVerticesData('position');
    const norms = mesh.getVerticesData('normal');
    if (!pos) { console.error(`[INV] ${mesh.name}: no position data`); return; }

    const name = mesh.name;
    const res = this.config.chunkResolution;
    const verts = res + 1;
    const vertexCount = verts * verts;
    const maxH = Math.max(0.01, heightAmp * 1.01);

    // I2: vertex count
    if (pos.length / 3 !== vertexCount) {
      console.error(`[INV] ${name}: I2 FAIL vertexCount=${pos.length / 3} expected=${vertexCount}`);
    }

    // I1: radial distance
    let i1 = true;
    let minD = Infinity, maxD = -Infinity;
    let badCount = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const d = Math.sqrt(pos[i] * pos[i] + pos[i + 1] * pos[i + 1] + pos[i + 2] * pos[i + 2]);
      if (d < minD) minD = d;
      if (d > maxD) maxD = d;
      if (d < R - 0.1 || d > R + maxH + 0.1) { i1 = false; badCount++; }
    }
    if (!i1) {
      console.error(`[INV] ${name}: I1 FAIL radialDistance min=${minD.toFixed(2)} max=${maxD.toFixed(2)} R=${R} maxH=${(R+maxH).toFixed(2)} badVerts=${badCount}`);
    }

    // I3: normal unit length
    if (norms) {
      let i3 = true;
      let badNorms = 0;
      for (let i = 0; i < norms.length; i += 3) {
        const len = Math.sqrt(norms[i] * norms[i] + norms[i + 1] * norms[i + 1] + norms[i + 2] * norms[i + 2]);
        if (Math.abs(len - 1) > 1e-4) { i3 = false; badNorms++; }
      }
      if (!i3) {
        console.error(`[INV] ${name}: I3 FAIL badNormals=${badNorms}/${norms.length/3}`);
      }
    }

    // I4: face origin
    const axis = faceIdx < 2 ? 0 : (faceIdx < 4 ? 1 : 2);
    const sign = faceIdx % 2 === 0 ? 1 : -1;
    let i4 = true;
    let axisViolations = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const val = pos[i + axis];
      if ((sign === 1 && val <= 0) || (sign === -1 && val >= 0)) { i4 = false; axisViolations++; }
    }
    if (!i4) {
      const axisName = ['X', 'Y', 'Z'][axis];
      console.error(`[INV] ${name}: I4 FAIL axis=${axisName} expectedSign=${sign > 0 ? '+' : '-'} violations=${axisViolations}`);
    }

    // I5: edge continuity with existing neighbors
    const neighborKeys: { key: string; edge: 'left' | 'right' | 'bottom' | 'top' }[] = [];
    // left neighbor
    if (tx > 0) neighborKeys.push({ key: this.chunkKey(faceIdx, depth, tx - 1, ty), edge: 'right' });
    // right neighbor
    neighborKeys.push({ key: this.chunkKey(faceIdx, depth, tx + 1, ty), edge: 'left' });
    // bottom neighbor
    if (ty > 0) neighborKeys.push({ key: this.chunkKey(faceIdx, depth, tx, ty - 1), edge: 'top' });
    // top neighbor
    neighborKeys.push({ key: this.chunkKey(faceIdx, depth, tx, ty + 1), edge: 'bottom' });

    for (const { key, edge } of neighborKeys) {
      const entry = this.cache.get(key);
      if (!entry) continue;
      const nPos = entry.mesh.getVerticesData('position');
      if (!nPos) continue;

      let mismatches = 0;
      let maxDiff = 0;

      for (let k = 0; k < verts; k++) {
        let idxThis: number, idxNeighbor: number;
        if (edge === 'right') { idxThis = k * verts * 3; idxNeighbor = (k * verts + res) * 3; }
        else if (edge === 'left') { idxThis = (k * verts + res) * 3; idxNeighbor = k * verts * 3; }
        else if (edge === 'top') { idxThis = k * 3; idxNeighbor = (res * verts + k) * 3; }
        else { idxThis = (res * verts + k) * 3; idxNeighbor = k * 3; }

        const dx = Math.abs(pos[idxThis] - nPos[idxNeighbor]);
        const dy = Math.abs(pos[idxThis + 1] - nPos[idxNeighbor + 1]);
        const dz = Math.abs(pos[idxThis + 2] - nPos[idxNeighbor + 2]);
        const diff = Math.max(dx, dy, dz);
        if (diff > maxDiff) maxDiff = diff;
        if (diff >= 0.01) mismatches++;
      }

      if (mismatches > 0) {
        console.error(`[INV] ${name}: I5 FAIL edge=${edge} neighbor=${key} mismatches=${mismatches}/${verts} maxDiff=${maxDiff.toFixed(6)}`);
      }
    }

    // Log if chunk is off-planet (far from expected radial range)
    if (minD > R + heightAmp * 2 || maxD < R - heightAmp) {
      console.error(`[INV] ${name}: OFF-PLANET minD=${minD.toFixed(2)} maxD=${maxD.toFixed(2)} R=${R}`);
    }
  }

  dispose(): void {
    for (const [, entry] of this.cache) {
      entry.mesh.dispose();
    }
    this.cache.clear();
  }
}

function uvToDirTangent(faceIdx: number, u: number, v: number, dir: 'u' | 'v'): Vector3 {
  const eps = 0.001;
  if (dir === 'u') {
    return uvToDir(faceIdx, u + eps, v).normalize().subtract(uvToDir(faceIdx, u - eps, v).normalize());
  }
  return uvToDir(faceIdx, u, v + eps).normalize().subtract(uvToDir(faceIdx, u, v - eps).normalize());
}
