import {
  Group,
  Mesh,
  MeshStandardMaterial,
  BufferGeometry,
  BufferAttribute,
  Vector3,
} from 'three';
import { HeightSampler } from './HeightSampler';

export interface LODConfig {
  planetRadius: number;
  seed: number;
  heightAmplitude: number;
  maxDepth: number;
  maxChunks: number;
  chunkResolution: number;
}

const DEFAULTS: Required<LODConfig> = {
  planetRadius: 6371,
  seed: Math.random() * 2147483647,
  heightAmplitude: 8,
  maxDepth: 12,
  maxChunks: 1000,
  chunkResolution: 16,
};

// Cube face definitions: axis (0=X,1=Y,2=Z), sign (+/-1)
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

// Faces where uvToDir produces inward-facing triangle normals.
// The winding direction depends on how u/v map to the 3 axes per face.
// Affected: faces where (sign===-1 && axis!==1) or (sign===1 && axis===1)
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
    if (i === axis) {
      out.setComponent(i, sign);
    } else {
      out.setComponent(i, coords[ci++]);
    }
  }
  return out;
}

function getBiomeColor(normalizedHeight: number, lat: number): [number, number, number] {
  // Adjust snow threshold at high latitudes (polar caps)
  const snowThreshold = 0.85 - Math.max(0, Math.abs(lat) - Math.PI / 3) * 0.8;
  const adjustedHeight = normalizedHeight;

  if (adjustedHeight < 0.1) return [0.102, 0.239, 0.420]; // deep water #1a3d6b
  if (adjustedHeight < 0.25) return [0.157, 0.502, 0.725]; // shallow #2980b9
  if (adjustedHeight < 0.3) return [0.831, 0.655, 0.416]; // sand #d4a76a
  if (adjustedHeight < 0.55) return [0.290, 0.549, 0.247]; // grass #4a8c3f
  if (adjustedHeight < 0.7) return [0.176, 0.353, 0.153]; // forest #2d5a27
  if (adjustedHeight < snowThreshold) return [0.478, 0.478, 0.478]; // rock #7a7a7a
  return [0.941, 0.941, 0.941]; // snow #f0f0f0
}

export class LODPlanet {
  private config: Required<LODConfig>;
  private sampler: HeightSampler;
  private group: Group;
  private cache: Map<string, ChunkCacheEntry> = new Map();

  constructor(config?: Partial<LODConfig>) {
    this.config = { ...DEFAULTS, ...config };
    this.sampler = new HeightSampler(this.config.seed);
    this.group = new Group();
  }

  getMesh(): Group {
    return this.group;
  }

  getHeightAt(worldPos: Vector3): number {
    return this.sampler.getHeight(worldPos.x, worldPos.y, worldPos.z);
  }

  update(cameraPos: Vector3): void {
    const now = performance.now();
    const R = this.config.planetRadius;
    const maxDepth = this.config.maxDepth;
    const distFromCenter = cameraPos.length();
    const distFromSurface = Math.max(0, distFromCenter - R);
    const heightAmp = this.config.heightAmplitude;

    // Determine max depth for this frame based on distance
    let effectiveDepth = maxDepth;
    if (distFromSurface > 0) {
      const levels = Math.floor(Math.log2(distFromSurface / 5 + 1));
      effectiveDepth = Math.max(0, maxDepth - levels);
    }

    // Collect all nodes to generate
    const needed: { faceIdx: number; depth: number; tx: number; ty: number }[] = [];

    for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
      // Face visibility: dot(faceNormal, cameraDir) > -0.2
      const camDir = _tmpVec.copy(cameraPos).normalize();
      const dot = camDir.dot(FACE_NORMALS[faceIdx]);
      if (dot < -0.2) continue; // facing away

      this.traverseFace(faceIdx, cameraPos, effectiveDepth, 0, 0, 0, needed);
    }

    // Keep track of which chunks we need this frame
    const neededSet = new Set<string>();

    for (const node of needed) {
      const key = this.chunkKey(node.faceIdx, node.depth, node.tx, node.ty);
      neededSet.add(key);

      if (this.cache.has(key)) {
        // Update access time
        const entry = this.cache.get(key)!;
        entry.lastAccess = now;
        if (entry.mesh.parent !== this.group) {
          this.group.add(entry.mesh);
        }
      } else {
        // Generate new chunk
        if (this.cache.size >= this.config.maxChunks) {
          this.evictOldest(neededSet);
        }
        const mesh = this.generateChunk(node.faceIdx, node.depth, node.tx, node.ty, R, heightAmp);
        if (mesh) {
          this.cache.set(key, { mesh, lastAccess: now });
          this.group.add(mesh);
        }
      }
    }

    // Remove chunks no longer needed
    for (const [key, entry] of this.cache) {
      if (!neededSet.has(key)) {
        this.group.remove(entry.mesh);
      }
    }
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
    const size = 1 / (1 << depth); // uv size of this tile
    const cu = (tx + 0.5) * size * 2 - 1;
    const cv = (ty + 0.5) * size * 2 - 1;

    const centerDir = uvToDir(faceIdx, cu, cv).normalize();
    const surfacePos = _tmpVec.copy(centerDir).multiplyScalar(R);
    const dist = cameraPos.distanceTo(surfacePos);
    const chunkWorldSize = (2 * Math.PI * R) / (4 * (1 << depth));

    // Determine if this node should split based on distance
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
        const samplePos = _tmpVec.copy(dir).multiplyScalar(R);
        const h = this.sampler.getHeight(samplePos.x, samplePos.y, samplePos.z);
        heightGrid[j][i] = h;
      }
    }

    for (let j = 0; j < verts; j++) {
      for (let i = 0; i < verts; i++) {
        const u = u0 + i * du;
        const v = v0 + j * dv;
        const h = heightGrid[j][i];

        const dir = uvToDir(faceIdx, u, v).normalize();
        const altitude = h * heightAmp;
        const px = dir.x * (R + altitude);
        const py = dir.y * (R + altitude);
        const pz = dir.z * (R + altitude);
        positions.push(px, py, pz);

        // Normal via central differences
        const duv = 1 / res * step * 2;
        const hu1 = i + 1 < verts ? heightGrid[j][i + 1] : h;
        const hu2 = i - 1 >= 0 ? heightGrid[j][i - 1] : h;
        const hv1 = j + 1 < verts ? heightGrid[j + 1][i] : h;
        const hv2 = j - 1 >= 0 ? heightGrid[j - 1][i] : h;

        const dhdu = (hu1 - hu2) / (2 * duv);
        const dhdv = (hv1 - hv2) / (2 * duv);

        // Perturb the surface direction by the height gradient
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

        // Biome color
        const lat = Math.asin(Math.max(-1, Math.min(1, dir.y)));
        const [cr, cg, cb] = getBiomeColor(h, lat);
        colors.push(cr, cg, cb);
      }
    }

    // Indices (triangle strip as triangles)
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const a = j * verts + i;
        const b = j * verts + i + 1;
        const c = (j + 1) * verts + i;
        const d = (j + 1) * verts + i + 1;
        if (FACE_WINDING_FLIP[faceIdx]) {
          indices.push(a, c, b);
          indices.push(c, d, b);
        } else {
          indices.push(a, b, c);
          indices.push(b, d, c);
        }
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    geo.setIndex(indices);

    const mat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      metalness: 0.1,
    });

    const mesh = new Mesh(geo, mat);
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
      this.group.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      const mat = entry.mesh.material;
      if (!Array.isArray(mat)) mat.dispose();
      this.cache.delete(oldestKey);
    }
  }

  private chunkKey(faceIdx: number, depth: number, tx: number, ty: number): string {
    return `f${faceIdx}-d${depth}-${tx}-${ty}`;
  }

  dispose(): void {
    for (const [, entry] of this.cache) {
      this.group.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      const mat = entry.mesh.material;
      if (!Array.isArray(mat)) mat.dispose();
    }
    this.cache.clear();
  }
}

function uvToDirTangent(faceIdx: number, u: number, v: number, dir: 'u' | 'v'): Vector3 {
  const eps = 0.001;
  if (dir === 'u') {
    return uvToDir(faceIdx, u + eps, v).normalize().sub(uvToDir(faceIdx, u - eps, v).normalize());
  }
  return uvToDir(faceIdx, u, v + eps).normalize().sub(uvToDir(faceIdx, u, v - eps).normalize());
}
