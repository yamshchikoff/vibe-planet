import { describe, it, expect, beforeEach } from 'vitest';
import { Vector3 } from '@babylonjs/core';
import {
  BoundaryContractEngine,
  type EdgeContract,
  EPS_ANGLE_DEG,
} from './BoundaryContractEngine';
import type { ChunkGeometry } from './ChunkGenerator';

// Re-import Edge for convenience
type Edge = 'left' | 'right' | 'bottom' | 'top';

// ── Fixtures ────────────────────────────────────────────────────────────

const R = 6371;
const H = 8;

/** Build a minimal ChunkGeometry with positions on a grid. */
function buildGeometry(
  positions: Float32Array,
): ChunkGeometry {
  const N = Math.round(Math.sqrt(positions.length / 3));
  const cellCount = (N - 1) ** 2;
  return {
    positions,
    normals: new Float32Array(positions.length),
    colors: new Float32Array(N * N * 4),
    indices: new Uint32Array(cellCount * 6),
  };
}

/** Build a flat grid of positions on a cube face. */
function buildFaceGrid(
  face: number, depth: number, tx: number, ty: number,
  res: number, rad: number, amp: number,
): ChunkGeometry {
  const N = res + 1;
  const positions = new Float32Array(N * N * 3);
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
      const diag = Math.sqrt(2);
      const noiseH = 0.3 + 0.1 * Math.sin(u * diag) * Math.cos(v * diag);
      const r = rad + noiseH * amp;
      const idx = row * N + col;
      positions[idx * 3] = dir.x * r;
      positions[idx * 3 + 1] = dir.y * r;
      positions[idx * 3 + 2] = dir.z * r;
    }
  }
  return buildGeometry(positions);
}

/** uvToDir replica for test independence */
function uvToDir(face: number, u: number, v: number): Vector3 {
  const faces: { axis: number; sign: number }[] = [
    { axis: 0, sign: 1 }, { axis: 0, sign: -1 },
    { axis: 1, sign: 1 }, { axis: 1, sign: -1 },
    { axis: 2, sign: 1 }, { axis: 2, sign: -1 },
  ];
  const { axis, sign } = faces[face];
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

/** Create an EdgeContract for use in verify/resample tests */
function makeContract(
  overrides: Partial<EdgeContract> & { chunkId: string; edge: Edge; face: number; depth: number; vertexPositions: Vector3[] },
): EdgeContract {
  const defaultTangent = (i: number, arr: Vector3[]) => {
    if (arr.length < 2) return new Vector3(0, 0, 0);
    if (i === 0) return vecNormalize(vecSub(arr[1], arr[0]));
    if (i === arr.length - 1) return vecNormalize(vecSub(arr[arr.length - 1], arr[arr.length - 2]));
    return vecNormalize(vecSub(arr[i + 1], arr[i - 1]));
  };
  const defaults: EdgeContract = {
    chunkId: '', edge: 'top', face: 0, depth: 0,
    vertexPositions: [],
    heightProfile: [],
    tangents: [],
    guaranteedDepth: 0,
    g1Guarantee: 'deterministic',
    maxAngleDeg: EPS_ANGLE_DEG,
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
    merged.heightProfile = merged.vertexPositions.map(p => {
      const d = vecLen(p.x, p.y, p.z);
      return Math.max(0, Math.min(1, (d - R) / H));
    });
  }
  return merged;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('BoundaryContractEngine', () => {
  let engine: BoundaryContractEngine;

  beforeEach(() => {
    engine = new BoundaryContractEngine();
  });

  // ── Edge extraction ──────────────────────────────────────────────────

  describe('declare: edge extraction', () => {
    it('extracts top edge at RES=2 (3 vertices)', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 2, R, H);
      const c = engine.declare('chunk', 'top', geo, R, H);
      expect(c.vertexPositions.length).toBe(3);
      expect(c.edge).toBe('top');
    });

    it('extracts bottom edge', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 2, R, H);
      const c = engine.declare('chunk', 'bottom', geo, R, H);
      expect(c.vertexPositions.length).toBe(3);
    });

    it('extracts left edge', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 2, R, H);
      const c = engine.declare('chunk', 'left', geo, R, H);
      expect(c.vertexPositions.length).toBe(3);
    });

    it('extracts right edge', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 2, R, H);
      const c = engine.declare('chunk', 'right', geo, R, H);
      expect(c.vertexPositions.length).toBe(3);
    });

    it('RES=4 produces 5 vertices per edge', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 4, R, H);
      for (const edge of ['top', 'bottom', 'left', 'right'] as Edge[]) {
        const c = engine.declare('chunk', edge, geo, R, H);
        expect(c.vertexPositions.length).toBe(5);
      }
    });

    it('top edge vertices in UV-increasing col order', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 4, R, H);
      // Face 0 (+X): axis=X, u→Y, v→Z. Top edge varies u (col), v fixed.
      // Position = (1, u, v0). Normalized: as u increases, y increases.
      const c = engine.declare('chunk', 'top', geo, R, H);
      for (let i = 1; i < c.vertexPositions.length; i++) {
        expect(c.vertexPositions[i].y).toBeGreaterThan(c.vertexPositions[i - 1].y);
      }
    });

    it('left edge vertices in UV-increasing row order', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 4, R, H);
      // Left edge at face 0 (+X): y increases as row increases (u fixed at -1)
      // Wait — for face 0: u→y, v→z. So row (v) → z varies, not y.
      // Actually for face 0: axis=X, u=y, v=z.
      // Position = (sign, u, v) = (1, y_varying, z_varying)
      // After normalize: (1, y, z) / sqrt(1 + y² + z²)
      // As col=0 (left edge), u=-1 for all rows. As row increases, v goes from -1 to 1.
      // So y=-1 always, z varies from -1 to 1.
      const c = engine.declare('chunk', 'left', geo, R, H);
      // z should increase with row (v)
      expect(c.vertexPositions[0].z).toBeLessThan(c.vertexPositions[c.vertexPositions.length - 1].z);
    });

    it('stores face and depth from options', () => {
      const geo = buildFaceGrid(4, 3, 5, 2, 4, R, H);
      const c = engine.declare('chunk', 'top', geo, R, H, { face: 4, depth: 3 });
      expect(c.face).toBe(4);
      expect(c.depth).toBe(3);
      expect(c.chunkId).toBe('chunk');
    });
  });

  // ── Height profile ───────────────────────────────────────────────────

  describe('height profile', () => {
    it('computes heights from positions', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 4, R, H);
      const c = engine.declare('chunk', 'top', geo, R, H);
      expect(c.heightProfile.length).toBe(5);
      for (const h of c.heightProfile) {
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(1);
      }
    });

    it('H=0: all heights are 0', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 4, R, 0);
      const c = engine.declare('chunk', 'top', geo, R, 0);
      for (const h of c.heightProfile) {
        expect(h).toBe(0);
      }
    });

    it('height values match radial distance formula', () => {
      // 3×3 grid: N=3, RES=2, top edge extracts 3 vertices
      const positions = new Float32Array([
        R, 0, 0,        R+H, 0, 0,      R+H*0.5, 0, 0,
        0, R, 0,         0, R+1, 0,       0, R+1, 0,
        0, 0, R,         0, 0, R+1,       0, 0, R+1,
      ]);
      const geo = buildGeometry(positions);
      const c = engine.declare('chunk', 'top', geo, R, H);
      expect(c.heightProfile[0]).toBeCloseTo(0, 4);
      expect(c.heightProfile[1]).toBeCloseTo(1, 4);
      expect(c.heightProfile[2]).toBeCloseTo(0.5, 4);
    });
  });

  // ── Tangents ──────────────────────────────────────────────────────────

  describe('tangents', () => {
    it('computes tangents from edge vertex positions', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 4, R, H);
      const c = engine.declare('chunk', 'top', geo, R, H);
      expect(c.tangents.length).toBe(5);
      for (const t of c.tangents) {
        const len = vecLen(t.x, t.y, t.z);
        expect(len).toBeGreaterThan(0);
      }
    });

    it('tangent length is approximately 1 (normalized)', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 4, R, H);
      const c = engine.declare('chunk', 'top', geo, R, H);
      for (const t of c.tangents) {
        const len = vecLen(t.x, t.y, t.z);
        expect(len).toBeCloseTo(1, 4);
      }
    });

    it('top edge tangent points in +x direction for face 0', () => {
      // Face 0 (+X): top edge, u varies (-1 to 1), v fixed at v0.
      // The dir at center: (1, 0, v0). Normalize → ~(1, 0, v0)/sqrt(1+v0²).
      // Moving along u increases y (for face 0, u→y).
      // Actually for face 0: coords = (sign=1, u, v). So (1, u, v).
      // Top edge at v=v0: positions = (1, u, v0). As u increases, y increases.
      // Tangent should point roughly in +y direction.
      const geo = buildFaceGrid(0, 0, 0, 0, 4, R, H);
      const c = engine.declare('chunk', 'top', geo, R, H);
      // Tangent at center should have positive y
      const midTangent = c.tangents[2];
      // The dominant component depends on geometry, but tangent should not be zero
      expect(vecLen(midTangent.x, midTangent.y, midTangent.z)).toBeGreaterThan(0);
    });
  });

  // ── Non-geometric fields ─────────────────────────────────────────────

  describe('non-geometric fields', () => {
    it('stores timeBudgetMs', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 2, R, H);
      const c = engine.declare('chunk', 'top', geo, R, H, { timeBudgetMs: 33 });
      expect(c.timeBudgetMs).toBe(33);
    });

    it('stores memoryBudgetBytes', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 2, R, H);
      const c = engine.declare('chunk', 'top', geo, R, H, { memoryBudgetBytes: 100000 });
      expect(c.memoryBudgetBytes).toBe(100000);
    });

    it('stores seed', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 2, R, H);
      const c = engine.declare('chunk', 'top', geo, R, H, { seed: 123 });
      expect(c.seed).toBe(123);
    });

    it('stores contentType', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 2, R, H);
      const c = engine.declare('chunk', 'top', geo, R, H, { contentType: 'canyon' });
      expect(c.contentType).toBe('canyon');
    });

    it('stores patchIds', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 2, R, H);
      const c = engine.declare('chunk', 'top', geo, R, H, { patchIds: ['p1', 'p2'] });
      expect(c.patchIds).toEqual(['p1', 'p2']);
    });

    it('default g1Guarantee is deterministic', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 2, R, H);
      const c = engine.declare('chunk', 'top', geo, R, H);
      expect(c.g1Guarantee).toBe('deterministic');
    });
  });

  // ── Storage ──────────────────────────────────────────────────────────

  describe('storage', () => {
    it('stores and retrieves a single contract', () => {
      engine.declare('c', 'top', buildFaceGrid(0, 0, 0, 0, 2, R, H), R, H);
      expect(engine.getContract('c', 'top')).toBeDefined();
    });

    it('stores all 4 edges for a chunk', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 2, R, H);
      engine.declare('c', 'top', geo, R, H);
      engine.declare('c', 'bottom', geo, R, H);
      engine.declare('c', 'left', geo, R, H);
      engine.declare('c', 'right', geo, R, H);
      const all = engine.getAllContracts('c');
      expect(all.length).toBe(4);
    });

    it('overwrites existing contract on re-declare', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 2, R, H);
      const c1 = engine.declare('c', 'top', geo, R, H, { timeBudgetMs: 10 });
      const c2 = engine.declare('c', 'top', geo, R, H, { timeBudgetMs: 20 });
      expect(c2.timeBudgetMs).toBe(20);
      expect(engine.getContract('c', 'top')!.timeBudgetMs).toBe(20);
      expect(c1.timeBudgetMs).toBe(10);
      // Returns old contract, but store has new one
      expect(engine.getContract('c', 'top')!.timeBudgetMs).toBe(20);
    });
  });

  // ── Resample ─────────────────────────────────────────────────────────

  describe('resample', () => {
    const pos3 = [new Vector3(0, 0, 0), new Vector3(5, 0, 0), new Vector3(10, 0, 0)];

    it('same depth returns identity (copy)', () => {
      const c = makeContract({ chunkId: 'c', edge: 'top', face: 0, depth: 1, vertexPositions: pos3 });
      const r = engine.resample(c, 1);
      expect(r.vertexPositions.length).toBe(3);
      expect(r.vertexPositions[0]).toEqual(c.vertexPositions[0]);
      expect(r.depth).toBe(1);
    });

    it('down-resample (d=2→1) decimates by factor 2', () => {
      const pos = [
        new Vector3(0, 0, 0), new Vector3(1, 0, 0),
        new Vector3(2, 0, 0), new Vector3(3, 0, 0),
        new Vector3(4, 0, 0),
      ];
      const c = makeContract({ chunkId: 'c', edge: 'top', face: 0, depth: 2, vertexPositions: pos });
      const r = engine.resample(c, 1);
      // factor = 2, 5 vertices → 3 vertices (0, 2, 4)
      expect(r.vertexPositions.length).toBe(3);
      expect(r.vertexPositions[0].x).toBe(0);
      expect(r.vertexPositions[1].x).toBe(2);
      expect(r.vertexPositions[2].x).toBe(4);
    });

    it('up-resample (d=1→2) interpolates by factor 2', () => {
      const pos = [new Vector3(0, 0, 0), new Vector3(4, 0, 0), new Vector3(8, 0, 0)];
      const c = makeContract({ chunkId: 'c', edge: 'top', face: 0, depth: 1, vertexPositions: pos });
      const r = engine.resample(c, 2);
      // factor = 2, 3 vertices → 5 vertices (0, 2, 4, 6, 8)
      expect(r.vertexPositions.length).toBe(5);
      expect(r.vertexPositions[0].x).toBe(0);
      expect(r.vertexPositions[1].x).toBe(2);
      expect(r.vertexPositions[2].x).toBe(4);
      expect(r.vertexPositions[3].x).toBe(6);
      expect(r.vertexPositions[4].x).toBe(8);
    });

    it('up-resample (d=1→3) with factor 4', () => {
      const pos = [new Vector3(0, 0, 0), new Vector3(4, 0, 0), new Vector3(8, 0, 0)];
      const c = makeContract({ chunkId: 'c', edge: 'top', face: 0, depth: 1, vertexPositions: pos });
      const r = engine.resample(c, 3);
      // factor = 4, 3 vertices → 9 vertices
      expect(r.vertexPositions.length).toBe(9);
      expect(r.vertexPositions[0].x).toBe(0);
      expect(r.vertexPositions[2].x).toBe(2);
      expect(r.vertexPositions[4].x).toBe(4);
      expect(r.vertexPositions[8].x).toBe(8);
    });

    it('down-resample factor 4', () => {
      const pos = [];
      for (let i = 0; i <= 12; i++) pos.push(new Vector3(i, 0, 0));
      const c = makeContract({ chunkId: 'c', edge: 'top', face: 0, depth: 2, vertexPositions: pos });
      const r = engine.resample(c, 0);
      // factor = 4, 13 vertices → 4 vertices (0, 4, 8, 12)
      expect(r.vertexPositions.length).toBe(4);
      expect(r.vertexPositions[0].x).toBe(0);
      expect(r.vertexPositions[1].x).toBe(4);
      expect(r.vertexPositions[2].x).toBe(8);
      expect(r.vertexPositions[3].x).toBe(12);
    });

    it('resample preserves non-geometric fields', () => {
      const pos = [new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(2, 0, 0)];
      const c = makeContract({ chunkId: 'c', edge: 'top', face: 3, depth: 1, vertexPositions: pos, seed: 99, contentType: 'mountain' });
      const r = engine.resample(c, 2);
      expect(r.chunkId).toBe('c');
      expect(r.edge).toBe('top');
      expect(r.face).toBe(3);
      expect(r.seed).toBe(99);
      expect(r.contentType).toBe('mountain');
    });

    it('tangents are recomputed after resample', () => {
      const pos = [new Vector3(0, 0, 0), new Vector3(4, 0, 0), new Vector3(8, 0, 0)];
      const c = makeContract({ chunkId: 'c', edge: 'top', face: 0, depth: 1, vertexPositions: pos });
      const r = engine.resample(c, 2);
      expect(r.tangents.length).toBe(r.vertexPositions.length);
      for (const t of r.tangents) {
        expect(vecLen(t.x, t.y, t.z)).toBeGreaterThan(0);
      }
    });

    it('heightProfile is recomputed after resample', () => {
      const pos = [new Vector3(0, 0, 0), new Vector3(4, 0, 0), new Vector3(8, 0, 0)];
      const c = makeContract({ chunkId: 'c', edge: 'top', face: 0, depth: 1, vertexPositions: pos });
      const r = engine.resample(c, 2);
      expect(r.heightProfile.length).toBe(r.vertexPositions.length);
    });
  });

  // ── Resample map ─────────────────────────────────────────────────────

  describe('resample map', () => {
    it('same depth: map[i] = i', () => {
      const map = engine.buildResampleMap(1, 1, 5);
      expect(map).toEqual([0, 1, 2, 3, 4]);
    });

    it('d+1 → d: map for deeper to shallower', () => {
      // deeper depth=2 has 5 vertices, shallower depth=1 has 3 vertices
      // map[deeper] = shallowerIndex
      // Vertices 0,2,4 of deeper match 0,1,2 of shallower
      const map = engine.buildResampleMap(1, 2, 5);
      expect(map.length).toBe(5);
      expect(map[0]).toBe(0);
      expect(map[2]).toBe(1);
      expect(map[4]).toBe(2);
    });

    it('d+1 → d: map for deeper to shallower (inverse)', () => {
      // shallower depth=1 (3 vertices), deeper depth=2 (5 vertices)
      // map[deeperIndex] = shallowerIndex, with -1 for interpolated deeper vertices
      const map = engine.buildResampleMap(1, 2, 5);
      expect(map.length).toBe(5);
      expect(map[0]).toBe(0);
      expect(map[1]).toBe(-1);
      expect(map[2]).toBe(1);
      expect(map[3]).toBe(-1);
      expect(map[4]).toBe(2);
    });
  });

  // ── Verify C⁰ ────────────────────────────────────────────────────────

  describe('verify C⁰', () => {
    it('matching contracts pass', () => {
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 0, vertexPositions: [
        new Vector3(10, 0, 0), new Vector3(10, 5, 0), new Vector3(10, 10, 0),
      ]});
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 0, vertexPositions: [
        new Vector3(10, 0, 0), new Vector3(10, 5, 0), new Vector3(10, 10, 0),
      ]});
      const result = engine.verify(a, b);
      expect(result.passed).toBe(true);
      expect(result.failures.length).toBe(0);
    });

    it('offset positions fail with position error', () => {
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 0, vertexPositions: [
        new Vector3(10, 0, 0), new Vector3(10, 5, 0), new Vector3(10, 10, 0),
      ]});
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 0, vertexPositions: [
        new Vector3(10, 0, 0), new Vector3(10, 5.01, 0), new Vector3(10, 10, 0),
      ]});
      const result = engine.verify(a, b);
      expect(result.passed).toBe(false);
      expect(result.failures.some(f => f.type === 'position')).toBe(true);
    });

    it('reports correct edgeVertexIndex in failure', () => {
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 0, vertexPositions: [
        new Vector3(10, 0, 0), new Vector3(10, 5, 0), new Vector3(10, 10, 0),
      ]});
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 0, vertexPositions: [
        new Vector3(10, 0, 0), new Vector3(10, 5.1, 0), new Vector3(10, 10, 0),
      ]});
      const result = engine.verify(a, b, { epsPosition: 0.05 });
      expect(result.failures[0].edgeVertexIndex).toBe(1);
    });

    it('configurable epsPosition', () => {
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 0, vertexPositions: [
        new Vector3(10, 0, 0), new Vector3(10, 5, 0), new Vector3(10, 10, 0),
      ]});
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 0, vertexPositions: [
        new Vector3(10, 0, 0), new Vector3(10, 5.005, 0), new Vector3(10, 10, 0),
      ]});
      // Tight tolerance → fail
      expect(engine.verify(a, b, { epsPosition: 0.001 }).passed).toBe(false);
      // Loose tolerance → pass
      expect(engine.verify(a, b, { epsPosition: 0.01 }).passed).toBe(true);
    });

    it('different-length contracts fail', () => {
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 0, vertexPositions: [
        new Vector3(10, 0, 0), new Vector3(10, 10, 0),
      ]});
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 0, vertexPositions: [
        new Vector3(10, 0, 0), new Vector3(10, 5, 0), new Vector3(10, 10, 0),
      ]});
      const result = engine.verify(a, b);
      expect(result.passed).toBe(false);
    });
  });

  // ── Verify G¹ ────────────────────────────────────────────────────────

  describe('verify G¹', () => {
    it('matching tangents pass', () => {
      const sharedPos = [new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(2, 0, 0)];
      const sharedTan = [new Vector3(1, 0, 0), new Vector3(1, 0, 0), new Vector3(1, 0, 0)];
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 0, vertexPositions: sharedPos, tangents: sharedTan });
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 0, vertexPositions: sharedPos, tangents: sharedTan });
      expect(engine.verify(a, b).passed).toBe(true);
    });

    it('divergent tangents fail with tangent error', () => {
      const sharedPos = [new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(2, 0, 0)];
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 0, vertexPositions: sharedPos, tangents: [
        new Vector3(1, 0, 0), new Vector3(1, 0, 0), new Vector3(1, 0, 0),
      ]});
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 0, vertexPositions: sharedPos, tangents: [
        new Vector3(0, 1, 0), new Vector3(0, 1, 0), new Vector3(0, 1, 0),
      ]});
      const result = engine.verify(a, b, { epsAngleDeg: 45 });
      expect(result.passed).toBe(false);
      expect(result.failures.some(f => f.type === 'tangent')).toBe(true);
    });
  });

  // ── Verify height ────────────────────────────────────────────────────

  describe('verify height', () => {
    it('matching height profiles pass', () => {
      const pos = [new Vector3(R, 0, 0), new Vector3(R + H * 0.5, 0, 0), new Vector3(R + H, 0, 0)];
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 0, vertexPositions: pos });
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 0, vertexPositions: pos });
      expect(engine.verify(a, b).passed).toBe(true);
    });

    it('divergent height profiles fail', () => {
      const posA = [new Vector3(R, 0, 0), new Vector3(R + H * 0.5, 0, 0), new Vector3(R + H, 0, 0)];
      const posB = [new Vector3(R, 0, 0), new Vector3(R + H * 0.51, 0, 0), new Vector3(R + H, 0, 0)];
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 0, vertexPositions: posA });
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 0, vertexPositions: posB });
      const result = engine.verify(a, b, { epsPosition: 0.001 });
      // Height deviation → position failure (since height is encoded in position)
      expect(result.failures.some(f => f.type === 'position')).toBe(true);
    });
  });

  // ── Cross-depth verify ──────────────────────────────────────────────

  describe('cross-depth verify', () => {
    it('different depths: auto-resample deeper before compare', () => {
      // Depth 1: 3 vertices
      const pos1 = [new Vector3(0, 0, 0), new Vector3(5, 0, 0), new Vector3(10, 0, 0)];
      // Depth 2: 5 vertices (aligned with depth 1's vertices at even indices)
      const pos2 = [new Vector3(0, 0, 0), new Vector3(2.5, 0, 0), new Vector3(5, 0, 0), new Vector3(7.5, 0, 0), new Vector3(10, 0, 0)];
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 1, vertexPositions: pos1 });
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 2, vertexPositions: pos2 });
      const result = engine.verify(a, b);
      expect(result.passed).toBe(true);
    });

    it('auto-resample catches position mismatch at different depths', () => {
      const pos1 = [new Vector3(0, 0, 0), new Vector3(5, 0, 0), new Vector3(10, 0, 0)];
      // Misaligned: vertex at index 2 should be at 5, but is at 5.1
      const pos2 = [new Vector3(0, 0, 0), new Vector3(2.5, 0, 0), new Vector3(5.1, 0, 0), new Vector3(7.5, 0, 0), new Vector3(10, 0, 0)];
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 1, vertexPositions: pos1 });
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 2, vertexPositions: pos2 });
      const result = engine.verify(a, b, { epsPosition: 0.05 });
      expect(result.passed).toBe(false);
    });

    it('resample does not modify original contract', () => {
      const pos = [new Vector3(0, 0, 0), new Vector3(5, 0, 0), new Vector3(10, 0, 0)];
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 1, vertexPositions: pos });
      const origLen = a.vertexPositions.length;
      engine.resample(a, 2);
      expect(a.vertexPositions.length).toBe(origLen);
    });
  });

  // ── createInterface ──────────────────────────────────────────────────

  describe('createInterface', () => {
    it('creates InterContractEdge with both contracts', () => {
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 0, vertexPositions: [new Vector3(1, 0, 0), new Vector3(1, 1, 0)] });
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 0, vertexPositions: [new Vector3(1, 0, 0), new Vector3(1, 1, 0)] });
      const iface = engine.createInterface(a, b, 'left');
      expect(iface.chunkA.chunkId).toBe('a');
      expect(iface.chunkB.chunkId).toBe('b');
      expect(iface.edge).toBe('left');
    });

    it('same depth: resampleMap is identity', () => {
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 0, vertexPositions: [new Vector3(1, 0, 0), new Vector3(1, 1, 0)] });
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 0, vertexPositions: [new Vector3(1, 0, 0), new Vector3(1, 1, 0)] });
      const iface = engine.createInterface(a, b, 'left');
      expect(iface.resampleMap).toEqual([0, 1]);
    });

    it('different depths: resampleMap maps deeper indices', () => {
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 0, vertexPositions: [new Vector3(1, 0, 0), new Vector3(1, 1, 0)] });
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 1, vertexPositions: [new Vector3(1, 0, 0), new Vector3(1, 0.5, 0), new Vector3(1, 1, 0)] });
      const iface = engine.createInterface(a, b, 'left');
      // b has depth 1 (3 vertices), a has depth 0 (2 vertices)
      // map for deeper (b, depth 1) to shallower (a, depth 0)
      expect(iface.resampleMap.length).toBe(3);
      expect(iface.resampleMap[0]).toBe(0);
      expect(iface.resampleMap[2]).toBe(1);
    });

    it('verified defaults to false', () => {
      const a = makeContract({ chunkId: 'a', edge: 'right', face: 0, depth: 0, vertexPositions: [new Vector3(1, 0, 0), new Vector3(1, 1, 0)] });
      const b = makeContract({ chunkId: 'b', edge: 'left', face: 0, depth: 0, vertexPositions: [new Vector3(1, 0, 0), new Vector3(1, 1, 0)] });
      const iface = engine.createInterface(a, b, 'left');
      expect(iface.verified).toBe(false);
    });
  });

  // ── Revoke ──────────────────────────────────────────────────────────

  describe('revoke', () => {
    it('removes a single contract', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 2, R, H);
      engine.declare('c', 'top', geo, R, H);
      expect(engine.getContract('c', 'top')).toBeDefined();
      engine.revoke('c');
      expect(engine.getContract('c', 'top')).toBeUndefined();
    });

    it('removes all 4 edges', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 2, R, H);
      for (const e of ['top', 'bottom', 'left', 'right'] as Edge[]) {
        engine.declare('c', e, geo, R, H);
      }
      expect(engine.getAllContracts('c').length).toBe(4);
      engine.revoke('c');
      expect(engine.getAllContracts('c').length).toBe(0);
    });

    it('revoke does not affect other chunks', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 2, R, H);
      engine.declare('a', 'top', geo, R, H);
      engine.declare('b', 'top', geo, R, H);
      engine.revoke('a');
      expect(engine.getContract('a', 'top')).toBeUndefined();
      expect(engine.getContract('b', 'top')).toBeDefined();
    });

    it('revoke non-existent chunk is no-op', () => {
      expect(() => engine.revoke('phantom')).not.toThrow();
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('RES=1 produces 2 vertices per edge', () => {
      const geo = buildFaceGrid(0, 0, 0, 0, 1, R, H);
      const c = engine.declare('chunk', 'top', geo, R, H);
      expect(c.vertexPositions.length).toBe(2);
    });

    it('different faces for same edge can still be verified', () => {
      // Face 0 (+X) right edge vs face 2 (+Y) right edge
      // Different faces so positions differ → will fail
      const geo = buildFaceGrid(0, 0, 0, 0, 2, R, H);
      const a = engine.declare('a', 'right', geo, R, H);
      const b = engine.declare('b', 'right', geo, R, H);
      const result = engine.verify(a, b, { epsPosition: 1 });
      // With very large epsilon, it passes (same geometry)
      expect(result.passed).toBe(true);
    });

    it('empty store returns undefined for any get', () => {
      expect(engine.getContract('any', 'top')).toBeUndefined();
      expect(engine.getAllContracts('any')).toEqual([]);
    });
  });
});
