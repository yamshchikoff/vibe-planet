import { describe, it, expect } from 'vitest';
import { Vector3 } from '@babylonjs/core';
import { ContractVerifier, DEBUG, type SharedEdge } from './ContractVerifier';
import type { ChunkGeometry } from './ChunkGenerator';
import type { EdgeContract } from './BoundaryContractEngine';

// ── Constants ────────────────────────────────────────────────────────────

const R = 6371;
const H = 8;
const EPS = 0.001;

// ── Cube face table ──────────────────────────────────────────────────────

const FACES: { axis: number; sign: number }[] = [
  { axis: 0, sign: 1 },  // 0: +X
  { axis: 0, sign: -1 }, // 1: -X
  { axis: 1, sign: 1 },  // 2: +Y
  { axis: 1, sign: -1 }, // 3: -Y
  { axis: 2, sign: 1 },  // 4: +Z
  { axis: 2, sign: -1 }, // 5: -Z
];

// ── Helpers ──────────────────────────────────────────────────────────────

function uvToDir(face: number, u: number, v: number): Vector3 {
  const { axis, sign } = FACES[face];
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

function vecLen(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

function vecSub(a: Vector3, b: Vector3): Vector3 {
  return new Vector3(a.x - b.x, a.y - b.y, a.z - b.z);
}

function vecNormalize(v: Vector3): Vector3 {
  const len = vecLen(v.x, v.y, v.z);
  return len > 1e-10 ? new Vector3(v.x / len, v.y / len, v.z / len) : new Vector3(0, 0, 0);
}

function vecDist(a: Vector3, b: Vector3): number {
  return vecLen(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Wrap a Float32Array of positions into a minimal ChunkGeometry. */
function makeGeometry(positions: Float32Array): ChunkGeometry {
  const N = Math.round(Math.sqrt(positions.length / 3));
  const cellCount = (N - 1) ** 2;
  return {
    positions,
    normals: new Float32Array(positions.length),
    colors: new Float32Array(N * N * 4),
    indices: new Uint32Array(cellCount * 6),
  };
}

/** Generate a flat face grid with optional noise. */
function makeFaceGrid(
  face: number, depth: number, tx: number, ty: number,
  res: number, rad: number, amp: number,
  noiseFn?: (u: number, v: number) => number,
): ChunkGeometry {
  const N = res + 1;
  const positions = new Float32Array(N * N * 3);
  const normals = new Float32Array(N * N * 3);
  const colors = new Float32Array(N * N * 4);
  const step = 1 / (1 << depth);
  const u0 = tx * step * 2 - 1;
  const v0 = ty * step * 2 - 1;
  const du = step * 2 / res;
  const dv = step * 2 / res;

  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const u = u0 + col * du;
      const v = v0 + row * dv;
      const dir = uvToDir(face, u, v).normalize();
      const nh = noiseFn ? noiseFn(u, v) : 0;
      const r = rad + nh * amp;
      const idx = row * N + col;
      positions[idx * 3] = dir.x * r;
      positions[idx * 3 + 1] = dir.y * r;
      positions[idx * 3 + 2] = dir.z * r;
      // Unit normal (radial for flat sphere)
      const nLen = vecLen(dir.x, dir.y, dir.z);
      normals[idx * 3] = dir.x / nLen;
      normals[idx * 3 + 1] = dir.y / nLen;
      normals[idx * 3 + 2] = dir.z / nLen;
      colors[idx * 4 + 3] = 1;
    }
  }

  const cellCount = res * res;
  const indices = new Uint32Array(cellCount * 6);
  let i = 0;
  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      const tl = row * N + col;
      const tr = row * N + col + 1;
      const bl = (row + 1) * N + col;
      const br = (row + 1) * N + col + 1;
      indices[i++] = tl; indices[i++] = tr; indices[i++] = br;
      indices[i++] = tl; indices[i++] = br; indices[i++] = bl;
    }
  }

  return { positions, normals, colors, indices };
}

/** Create a contract with given vertex positions, auto-computing height profile and tangents. */
function makeContract(
  overrides: Partial<EdgeContract> & {
    chunkId: string; edge: 'left'|'right'|'bottom'|'top'; face: number; depth: number;
    vertexPositions: Vector3[];
  },
): EdgeContract {
  const defaultTangent = (_i: number, arr: Vector3[]) => {
    if (arr.length < 2) return new Vector3(0, 0, 0);
    if (_i === 0) return vecNormalize(vecSub(arr[1], arr[0]));
    if (_i === arr.length - 1) return vecNormalize(vecSub(arr[arr.length - 1], arr[arr.length - 2]));
    return vecNormalize(vecSub(arr[_i + 1], arr[_i - 1]));
  };
  const defaults: EdgeContract = {
    chunkId: '', edge: 'top', face: 0, depth: 0,
    vertexPositions: [],
    heightProfile: [],
    tangents: [],
    guaranteedDepth: 0,
    g1Guarantee: 'deterministic',
    maxAngleDeg: 0.1,
    timeBudgetMs: 16.6,
    memoryBudgetBytes: 50000,
    seed: 42,
    contentType: 'terrain',
    patchIds: [],
  };
  const merged = { ...defaults, ...overrides };
  if (!overrides.tangents) {
    merged.tangents = merged.vertexPositions.map((_, i, arr) => defaultTangent(i, arr));
  }
  if (!overrides.heightProfile) {
    merged.heightProfile = merged.vertexPositions.map(() => 0);
  }
  return merged;
}

/** Extract edge vertex positions from a ChunkGeometry. */
function extractEdgePositions(geo: ChunkGeometry, edge: 'left'|'right'|'bottom'|'top', N: number): Vector3[] {
  const { positions } = geo;
  const res = N - 1;
  const result: Vector3[] = [];
  const push = (idx: number) => {
    result.push(new Vector3(positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]));
  };
  switch (edge) {
    case 'top':
      for (let col = 0; col <= res; col++) push(col);
      break;
    case 'bottom':
      for (let col = 0; col <= res; col++) push(res * N + col);
      break;
    case 'left':
      for (let row = 0; row <= res; row++) push(row * N);
      break;
    case 'right':
      for (let row = 0; row <= res; row++) push(row * N + res);
      break;
  }
  return result;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('ContractVerifier', () => {
  // ── I1: Radial Distance ──────────────────────────────────────────────

  describe('I1: checkRadialDistance', () => {
    it('flat sphere (H=0): all vertices at exactly R', () => {
      const geo = makeFaceGrid(0, 0, 0, 0, 4, R, 0);
      expect(() => ContractVerifier.checkRadialDistance(geo, R, 0)).not.toThrow();
    });

    it('terrain with H=8: all vertices within [R, R+H]', () => {
      const geo = makeFaceGrid(0, 0, 0, 0, 4, R, H);
      expect(() => ContractVerifier.checkRadialDistance(geo, R, H)).not.toThrow();
    });

    it('all 6 faces pass', () => {
      for (let f = 0; f < 6; f++) {
        const geo = makeFaceGrid(f, 0, 0, 0, 4, R, H);
        expect(() => ContractVerifier.checkRadialDistance(geo, R, H)).not.toThrow();
      }
    });

    it('one vertex pushed beyond R+maxH throws', () => {
      const N = 3; // RES=2, 3×3 grid
      const positions = new Float32Array(N * N * 3);
      // Fill with normal positions
      const base = makeFaceGrid(0, 0, 0, 0, 2, R, H);
      positions.set(base.positions);
      // Push one vertex out
      positions[0] = positions[0] * 1.5; // x too far
      const geo = makeGeometry(positions);
      expect(() => ContractVerifier.checkRadialDistance(geo, R, H)).toThrow('I1');
    });

    it('vertex below R-eps throws', () => {
      const N = 3;
      const positions = new Float32Array(N * N * 3);
      positions.set(makeFaceGrid(0, 0, 0, 0, 2, R, H).positions);
      // Push one vertex inward
      const idx = 4 * 3; // center vertex
      const len = vecLen(positions[idx], positions[idx+1], positions[idx+2]);
      const scale = (R - 1) / len;
      positions[idx] *= scale;
      positions[idx+1] *= scale;
      positions[idx+2] *= scale;
      const geo = makeGeometry(positions);
      expect(() => ContractVerifier.checkRadialDistance(geo, R, H)).toThrow('I1');
    });
  });

  // ── I2: Vertex Count ─────────────────────────────────────────────────

  describe('I2: checkVertexCount', () => {
    it('RES=2: 9 vertices correct', () => {
      const geo = makeFaceGrid(0, 0, 0, 0, 2, R, 0);
      expect(() => ContractVerifier.checkVertexCount(geo, 2)).not.toThrow();
    });

    it('RES=4: 25 vertices correct', () => {
      const geo = makeFaceGrid(0, 0, 0, 0, 4, R, 0);
      expect(() => ContractVerifier.checkVertexCount(geo, 4)).not.toThrow();
    });

    it('RES=16: 289 vertices correct', () => {
      const geo = makeFaceGrid(0, 0, 0, 0, 16, R, 0);
      expect(() => ContractVerifier.checkVertexCount(geo, 16)).not.toThrow();
    });

    it('wrong vertex count throws', () => {
      const geo = makeFaceGrid(0, 0, 0, 0, 4, R, 0);
      expect(() => ContractVerifier.checkVertexCount(geo, 2)).toThrow('I2');
    });
  });

  // ── I3: Normals ──────────────────────────────────────────────────────

  describe('I3: checkNormals', () => {
    it('unit normals pass', () => {
      const geo = makeFaceGrid(0, 0, 0, 0, 4, R, 0);
      expect(() => ContractVerifier.checkNormals(geo)).not.toThrow();
    });

    it('all 6 faces have unit normals', () => {
      for (let f = 0; f < 6; f++) {
        const geo = makeFaceGrid(f, 0, 0, 0, 4, R, 0);
        expect(() => ContractVerifier.checkNormals(geo)).not.toThrow();
      }
    });

    it('zeroed normal throws', () => {
      const geo = makeFaceGrid(0, 0, 0, 0, 4, R, 0);
      // Zero out first normal
      geo.normals[0] = 0;
      geo.normals[1] = 0;
      geo.normals[2] = 0;
      expect(() => ContractVerifier.checkNormals(geo)).toThrow('I3');
    });

    it('non-unit normal throws', () => {
      const geo = makeFaceGrid(0, 0, 0, 0, 4, R, 0);
      geo.normals[0] *= 0.5;
      expect(() => ContractVerifier.checkNormals(geo)).toThrow('I3');
    });
  });

  // ── I4: Face Origin ──────────────────────────────────────────────────

  describe('I4: checkFaceOrigin', () => {
    it('face 0 (+X): all x > 0', () => {
      const geo = makeFaceGrid(0, 0, 0, 0, 4, R, 0);
      expect(() => ContractVerifier.checkFaceOrigin(geo, 0)).not.toThrow();
    });

    it('face 1 (-X): all x < 0', () => {
      const geo = makeFaceGrid(1, 0, 0, 0, 4, R, 0);
      expect(() => ContractVerifier.checkFaceOrigin(geo, 1)).not.toThrow();
    });

    it('face 2 (+Y): all y > 0', () => {
      const geo = makeFaceGrid(2, 0, 0, 0, 4, R, 0);
      expect(() => ContractVerifier.checkFaceOrigin(geo, 2)).not.toThrow();
    });

    it('face 3 (-Y): all y < 0', () => {
      const geo = makeFaceGrid(3, 0, 0, 0, 4, R, 0);
      expect(() => ContractVerifier.checkFaceOrigin(geo, 3)).not.toThrow();
    });

    it('face 4 (+Z): all z > 0', () => {
      const geo = makeFaceGrid(4, 0, 0, 0, 4, R, 0);
      expect(() => ContractVerifier.checkFaceOrigin(geo, 4)).not.toThrow();
    });

    it('face 5 (-Z): all z < 0', () => {
      const geo = makeFaceGrid(5, 0, 0, 0, 4, R, 0);
      expect(() => ContractVerifier.checkFaceOrigin(geo, 5)).not.toThrow();
    });

    it('vertex on wrong side throws', () => {
      const geo = makeFaceGrid(0, 0, 0, 0, 2, R, 0);
      // Force one vertex to negative x
      geo.positions[0] = -1;
      expect(() => ContractVerifier.checkFaceOrigin(geo, 0)).toThrow('I4');
    });
  });

  // ── I5: Split Seams ─────────────────────────────────────────────────

  describe('I5: checkSplitSeams', () => {
    /** Generate 4 children of a face-0 depth-0 chunk at depth 1, RES=2.
     *  Children: [tl, tr, bl, br] each with 3×3 vertices.
     *  Internal edges must match exactly. */
    function makeSplitChildren(res: number, amp: number): ChunkGeometry[] {
      return [
        makeFaceGrid(0, 1, 0, 0, res, R, amp),  // tl
        makeFaceGrid(0, 1, 1, 0, res, R, amp),  // tr
        makeFaceGrid(0, 1, 0, 1, res, R, amp),  // bl
        makeFaceGrid(0, 1, 1, 1, res, R, amp),  // br
      ];
    }

    it('matching split seams pass', () => {
      const children = makeSplitChildren(2, H);
      expect(() => ContractVerifier.checkSplitSeams(children, EPS)).not.toThrow();
    });

    it('RES=4 matching split seams pass', () => {
      const children = makeSplitChildren(4, H);
      expect(() => ContractVerifier.checkSplitSeams(children, EPS)).not.toThrow();
    });

    it('H=0 perfect sphere passes', () => {
      const children = makeSplitChildren(2, 0);
      expect(() => ContractVerifier.checkSplitSeams(children, EPS)).not.toThrow();
    });

    it('horizontal seam mismatch throws', () => {
      const children = makeSplitChildren(2, H);
      // Shift a vertex on tl bottom edge
      const tl = children[0];
      const N = 3; // (2+1)
      const bottomIdx = (N - 1) * N; // first vertex of bottom row
      tl.positions[bottomIdx * 3] += 100; // offset by 100m
      expect(() => ContractVerifier.checkSplitSeams(children, EPS)).toThrow('I5');
    });

    it('vertical seam mismatch throws', () => {
      const children = makeSplitChildren(2, H);
      // Shift a vertex on tl right edge
      const tl = children[0];
      const N = 3;
      const rightIdx = N - 1; // first column of right edge
      tl.positions[rightIdx * 3] += 100;
      expect(() => ContractVerifier.checkSplitSeams(children, EPS)).toThrow('I5');
    });

    it('center point mismatch throws', () => {
      const children = makeSplitChildren(2, H);
      // Shift the bottom-right corner of tl (which is the center)
      const tl = children[0];
      const N = 3;
      const brIdx = N * N - 1; // last vertex in tl = center of parent
      tl.positions[brIdx * 3] += 100;
      expect(() => ContractVerifier.checkSplitSeams(children, EPS)).toThrow('I5');
    });

    it('wrong number of children throws', () => {
      const children = makeSplitChildren(2, H).slice(0, 2);
      expect(() => ContractVerifier.checkSplitSeams(children, EPS)).toThrow('I5');
    });
  });

  // ── I6: External Perimeter ───────────────────────────────────────────

  describe('I6: checkExternalPerimeter', () => {
    /** Create 4 children and their parent-level neighbor contracts. */
    function makePerimeterTest(res: number, amp: number) {
      const children = [
        makeFaceGrid(0, 1, 0, 0, res, R, amp),  // tl
        makeFaceGrid(0, 1, 1, 0, res, R, amp),  // tr
        makeFaceGrid(0, 1, 0, 1, res, R, amp),  // bl
        makeFaceGrid(0, 1, 1, 1, res, R, amp),  // br
      ];
      const N = res + 1;

      // Build neighbor contracts from the external perimeter of the children.
      // The parent's left edge = tl left edge + bl left edge (top to bottom)
      const leftVerts = [
        ...extractEdgePositions(children[0], 'left', N),
        ...extractEdgePositions(children[2], 'left', N),
      ];
      const rightVerts = [
        ...extractEdgePositions(children[1], 'right', N),
        ...extractEdgePositions(children[3], 'right', N),
      ];
      const topVerts = [
        ...extractEdgePositions(children[0], 'top', N),
        ...extractEdgePositions(children[1], 'top', N),
      ];
      const bottomVerts = [
        ...extractEdgePositions(children[2], 'bottom', N),
        ...extractEdgePositions(children[3], 'bottom', N),
      ];

      const neighborContracts = new Map<string, EdgeContract>([
        ['left', makeContract({ chunkId: 'neighbor', edge: 'right', face: 0, depth: 0, vertexPositions: leftVerts })],
        ['right', makeContract({ chunkId: 'neighbor', edge: 'left', face: 0, depth: 0, vertexPositions: rightVerts })],
        ['top', makeContract({ chunkId: 'neighbor', edge: 'bottom', face: 0, depth: 0, vertexPositions: topVerts })],
        ['bottom', makeContract({ chunkId: 'neighbor', edge: 'top', face: 0, depth: 0, vertexPositions: bottomVerts })],
      ]);

      return { children, neighborContracts, N };
    }

    it('matching perimeter passes', () => {
      const { children, neighborContracts } = makePerimeterTest(2, H);
      expect(() => ContractVerifier.checkExternalPerimeter(children, neighborContracts, EPS)).not.toThrow();
    });

    it('RES=4 matching perimeter passes', () => {
      const { children, neighborContracts } = makePerimeterTest(4, H);
      expect(() => ContractVerifier.checkExternalPerimeter(children, neighborContracts, EPS)).not.toThrow();
    });

    it('mismatch on left edge throws', () => {
      const { children, neighborContracts } = makePerimeterTest(2, H);
      // Corrupt the left contract
      const left = neighborContracts.get('left')!;
      left.vertexPositions[0] = new Vector3(9999, 0, 0);
      expect(() => ContractVerifier.checkExternalPerimeter(children, neighborContracts, EPS)).toThrow('I6');
    });

    it('mismatch on top edge throws', () => {
      const { children, neighborContracts } = makePerimeterTest(2, H);
      const top = neighborContracts.get('top')!;
      top.vertexPositions[0] = new Vector3(9999, 0, 0);
      expect(() => ContractVerifier.checkExternalPerimeter(children, neighborContracts, EPS)).toThrow('I6');
    });

    it('missing neighbor contracts skip those edges (free edges)', () => {
      const { children } = makePerimeterTest(2, H);
      const emptyContracts = new Map<string, EdgeContract>();
      // No contracts → all edges are free → no checks
      expect(() => ContractVerifier.checkExternalPerimeter(children, emptyContracts, EPS)).not.toThrow();
    });
  });

  // ── I7: Round Trip ───────────────────────────────────────────────────

  describe('I7: checkRoundTrip', () => {
    it('identical geometry passes', () => {
      const geo = makeFaceGrid(0, 0, 0, 0, 4, R, H);
      const cloned: ChunkGeometry = {
        positions: new Float32Array(geo.positions),
        normals: new Float32Array(geo.normals),
        colors: new Float32Array(geo.colors),
        indices: new Uint32Array(geo.indices),
      };
      expect(() => ContractVerifier.checkRoundTrip(geo, cloned, 0)).not.toThrow();
    });

    it('identical geometry with tolerance=0 passes', () => {
      const geo = makeFaceGrid(0, 0, 0, 0, 2, R, 0);
      const cloned: ChunkGeometry = {
        positions: new Float32Array(geo.positions),
        normals: new Float32Array(geo.normals),
        colors: new Float32Array(geo.colors),
        indices: new Uint32Array(geo.indices),
      };
      expect(() => ContractVerifier.checkRoundTrip(geo, cloned, 0)).not.toThrow();
    });

    it('altered position throws', () => {
      const geo = makeFaceGrid(0, 0, 0, 0, 2, R, 0);
      const cloned: ChunkGeometry = {
        positions: new Float32Array(geo.positions),
        normals: new Float32Array(geo.normals),
        colors: new Float32Array(geo.colors),
        indices: new Uint32Array(geo.indices),
      };
      cloned.positions[0] += 5;
      expect(() => ContractVerifier.checkRoundTrip(geo, cloned, EPS)).toThrow('I7');
    });

    it('altered normal throws', () => {
      const geo = makeFaceGrid(0, 0, 0, 0, 2, R, 0);
      const cloned: ChunkGeometry = {
        positions: new Float32Array(geo.positions),
        normals: new Float32Array(geo.normals),
        colors: new Float32Array(geo.colors),
        indices: new Uint32Array(geo.indices),
      };
      cloned.normals[0] = 99;
      expect(() => ContractVerifier.checkRoundTrip(geo, cloned, EPS)).toThrow('I7');
    });

    it('different position count throws', () => {
      const geo = makeFaceGrid(0, 0, 0, 0, 2, R, 0);
      const cloned: ChunkGeometry = {
        positions: new Float32Array(geo.positions.length - 3),
        normals: new Float32Array(geo.normals),
        colors: new Float32Array(geo.colors),
        indices: new Uint32Array(geo.indices),
      };
      expect(() => ContractVerifier.checkRoundTrip(geo, cloned, EPS)).toThrow('I7');
    });
  });

  // ── I8: Contract Match ───────────────────────────────────────────────

  describe('I8: checkContractMatch', () => {
    const pos3 = [new Vector3(0, 0, 0), new Vector3(5, 0, 0), new Vector3(10, 0, 0)];
    const heights3 = [0, 0.5, 1];
    const tanX = [new Vector3(1, 0, 0), new Vector3(1, 0, 0), new Vector3(1, 0, 0)];

    it('matching contracts pass (same depth)', () => {
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 0, vertexPositions: pos3, heightProfile: heights3, tangents: tanX });
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 0, vertexPositions: pos3, heightProfile: heights3, tangents: tanX });
      expect(() => ContractVerifier.checkContractMatch(a, b, EPS)).not.toThrow();
    });

    it('cross-depth matching contracts pass', () => {
      // Depth 0: 3 vertices
      const pos0 = [new Vector3(0, 0, 0), new Vector3(5, 0, 0), new Vector3(10, 0, 0)];
      // Depth 1: 5 vertices (aligned at even indices)
      const pos1 = [new Vector3(0, 0, 0), new Vector3(2.5, 0, 0), new Vector3(5, 0, 0), new Vector3(7.5, 0, 0), new Vector3(10, 0, 0)];
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 0, vertexPositions: pos0, heightProfile: [0, 0.5, 1], tangents: tanX });
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 1, vertexPositions: pos1, heightProfile: [0, 0.25, 0.5, 0.75, 1], tangents: tanX });
      expect(() => ContractVerifier.checkContractMatch(a, b, EPS)).not.toThrow();
    });

    it('position mismatch throws', () => {
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 0, vertexPositions: pos3, heightProfile: heights3, tangents: tanX });
      const offsetPos = [new Vector3(0, 0, 0), new Vector3(5.1, 0, 0), new Vector3(10, 0, 0)];
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 0, vertexPositions: offsetPos, heightProfile: heights3, tangents: tanX });
      expect(() => ContractVerifier.checkContractMatch(a, b, EPS)).toThrow('I8');
    });

    it('tangent mismatch throws', () => {
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 0, vertexPositions: pos3, heightProfile: heights3, tangents: tanX });
      const tanY = [new Vector3(0, 1, 0), new Vector3(0, 1, 0), new Vector3(0, 1, 0)];
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 0, vertexPositions: pos3, heightProfile: heights3, tangents: tanY });
      expect(() => ContractVerifier.checkContractMatch(a, b, EPS)).toThrow('I8');
    });

    it('height profile mismatch throws', () => {
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 0, vertexPositions: pos3, heightProfile: heights3, tangents: tanX });
      const badHeights = [0, 0.6, 1];
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 0, vertexPositions: pos3, heightProfile: badHeights, tangents: tanX });
      expect(() => ContractVerifier.checkContractMatch(a, b, EPS)).toThrow('I8');
    });
  });

  // ── I9: LOD Coherence ───────────────────────────────────────────────

  describe('I9: checkLODCoherence', () => {
    /** Create a parent at depth 0 and 4 children at depth 1.
     *  Uses face 0 with RES=2 so parent has 3×3, children have 3×3 each.
     *  With factor-2 LOD, every 2nd child vertex maps to a parent vertex. */
    function makeLODTest(): { parent: ChunkGeometry; children: ChunkGeometry[] } {
      // Parent at depth 0, RES=2, flat (H=0) for exact matching
      const parent = makeFaceGrid(0, 0, 0, 0, 2, R, 0);

      // Children at depth 1, RES=2, flat (H=0)
      const children = [
        makeFaceGrid(0, 1, 0, 0, 2, R, 0),  // tl
        makeFaceGrid(0, 1, 1, 0, 2, R, 0),  // tr
        makeFaceGrid(0, 1, 0, 1, 2, R, 0),  // bl
        makeFaceGrid(0, 1, 1, 1, 2, R, 0),  // br
      ];

      return { parent, children };
    }

    it('coherent parent-children pass', () => {
      const { parent, children } = makeLODTest();
      expect(() => ContractVerifier.checkLODCoherence(parent, children, EPS)).not.toThrow();
    });

    it('mismatch in child position throws', () => {
      const { parent, children } = makeLODTest();
      // Offset a vertex in tl child that maps to a parent vertex
      // tl at child depth 1, RES=2 has 3×3 grid.
      // tl(0,0) = parent(0,0) — offset it
      children[0].positions[0] += 100;
      expect(() => ContractVerifier.checkLODCoherence(parent, children, EPS)).toThrow('I9');
    });

    it('mismatch in tr child throws', () => {
      const { parent, children } = makeLODTest();
      // tr(0,1) in child = parent(1,0) — offset
      children[1].positions[0] += 100;
      expect(() => ContractVerifier.checkLODCoherence(parent, children, EPS)).toThrow('I9');
    });

    it('wrong number of children throws', () => {
      const { parent } = makeLODTest();
      const twoChildren = [makeFaceGrid(0, 1, 0, 0, 2, R, 0), makeFaceGrid(0, 1, 1, 0, 2, R, 0)];
      expect(() => ContractVerifier.checkLODCoherence(parent, twoChildren, EPS)).toThrow('I9');
    });
  });

  // ── I10: Cross-Face Continuity ──────────────────────────────────────

  describe('I10: checkCrossFaceContinuity', () => {
    /** Face 0 (+X) right edge borders face 2 (+Y) right edge on a cube.
     *  Face 0: axis=X, u→Y, v→Z. Right edge: u=1 (y=1), v varies.
     *  Face 2: axis=Y, u→Z, v→X. Right edge: u=1 (z=1), v varies.
     *  The shared edge is where face 0's right edge meets face 2's right edge.
     *  On a cube: face 0 at (1, y, z) and face 2 at (x, 1, z).
     *  The shared line is (1, 1, z) for z ∈ [-1, 1].
     *  After normalization + scaling, vertices should match. */
    function makeCrossFaceTest(res: number, amp: number): { geomA: ChunkGeometry; geomB: ChunkGeometry; sharedEdge: SharedEdge } {
      // Face 0 (+X) rightmost column, at depth 0 so it spans the full face
      const geomA = makeFaceGrid(0, 0, 0, 0, res, R, amp);
      // Face 2 (+Y) rightmost column
      const geomB = makeFaceGrid(2, 0, 0, 0, res, R, amp);
      const sharedEdge: SharedEdge = {
        edgeA: 'right',
        edgeB: 'right',
        orientationA: 'direct',
        orientationB: 'direct',
      };
      return { geomA, geomB, sharedEdge };
    }

    it('matching cross-face edges pass', () => {
      const { geomA, geomB, sharedEdge } = makeCrossFaceTest(4, 0);
      expect(() => ContractVerifier.checkCrossFaceContinuity(geomA, geomB, sharedEdge, EPS)).not.toThrow();
    });

    it('H=0 (sphere) passes', () => {
      const { geomA, geomB, sharedEdge } = makeCrossFaceTest(2, 0);
      expect(() => ContractVerifier.checkCrossFaceContinuity(geomA, geomB, sharedEdge, EPS)).not.toThrow();
    });

    it('H=8 terrain passes', () => {
      const { geomA, geomB, sharedEdge } = makeCrossFaceTest(4, H);
      expect(() => ContractVerifier.checkCrossFaceContinuity(geomA, geomB, sharedEdge, EPS)).not.toThrow();
    });

    it('mismatch between faces throws', () => {
      const { geomA, geomB, sharedEdge } = makeCrossFaceTest(4, 0);
      // Offset a vertex on geomA's right edge
      const N = 5; // 4+1
      geomA.positions[(N - 1) * 3] += 100; // first vertex of right edge (tx=res)
      expect(() => ContractVerifier.checkCrossFaceContinuity(geomA, geomB, sharedEdge, EPS)).toThrow('I10');
    });

    it('face 0 right vs face 4 top edge', () => {
      // Face 0 (+X) top edge borders face 4 (+Z) right edge.
      // Face 0 top: u varies, v=1
      // Face 4 right: u=1, v varies
      const geomA = makeFaceGrid(0, 0, 0, 0, 4, R, 0);
      const geomB = makeFaceGrid(4, 0, 0, 0, 4, R, 0);
      // Face 0 (+X) v_max edge (edge-extraction 'bottom') meets face 4 (+Z) u_max edge ('right').
      // Both walk from (-1,-1) to (1,1) in the other face's axes → same orientation.
      const sharedEdge: SharedEdge = {
        edgeA: 'bottom',
        edgeB: 'right',
        orientationA: 'direct',
        orientationB: 'direct',
      };
      expect(() => ContractVerifier.checkCrossFaceContinuity(geomA, geomB, sharedEdge, EPS)).not.toThrow();
    });

    it('different resolutions throw', () => {
      const geomA = makeFaceGrid(0, 0, 0, 0, 4, R, 0);
      const geomB = makeFaceGrid(2, 0, 0, 0, 2, R, 0);
      const sharedEdge: SharedEdge = {
        edgeA: 'right',
        edgeB: 'right',
        orientationA: 'direct',
        orientationB: 'direct',
      };
      // Different N values → different edge vertex counts → should handle gracefully (throw or compare what's possible)
      expect(() => ContractVerifier.checkCrossFaceContinuity(geomA, geomB, sharedEdge, EPS)).toThrow('I10');
    });
  });

  // ── DEBUG mode ──────────────────────────────────────────────────────

  describe('DEBUG mode', () => {
    it('DEBUG=true allows throwing', () => {
      expect(DEBUG).toBe(true);
    });

    it('checkRadialDistance throws on bad data when DEBUG=true', () => {
      const N = 3;
      const positions = new Float32Array(N * N * 3);
      const geo = makeGeometry(positions); // all zeros
      expect(() => ContractVerifier.checkRadialDistance(geo, R, H)).toThrow('I1');
    });
  });
});
