import { describe, it, expect } from 'vitest';
import { Vector3 } from '@babylonjs/core';
import { LODPlanet, uvToDir } from './LODPlanet';

describe('uvToDir', () => {
  // I4: Face origin invariant — each face's axis has the correct sign
  it('face 0 (+X) maps to positive X for any UV', () => {
    for (const u of [-1, -0.5, 0, 0.5, 1]) {
      for (const v of [-1, -0.5, 0, 0.5, 1]) {
        const dir = uvToDir(0, u, v);
        expect(dir.x).toBeGreaterThan(0);
      }
    }
  });

  it('face 1 (-X) maps to negative X for any UV', () => {
    for (const u of [-1, -0.5, 0, 0.5, 1]) {
      for (const v of [-1, -0.5, 0, 0.5, 1]) {
        const dir = uvToDir(1, u, v);
        expect(dir.x).toBeLessThan(0);
      }
    }
  });

  it('face 2 (+Y) maps to positive Y for any UV', () => {
    for (const u of [-1, -0.5, 0, 0.5, 1]) {
      for (const v of [-1, -0.5, 0, 0.5, 1]) {
        const dir = uvToDir(2, u, v);
        expect(dir.y).toBeGreaterThan(0);
      }
    }
  });

  it('face 3 (-Y) maps to negative Y for any UV', () => {
    for (const u of [-1, -0.5, 0, 0.5, 1]) {
      for (const v of [-1, -0.5, 0, 0.5, 1]) {
        const dir = uvToDir(3, u, v);
        expect(dir.y).toBeLessThan(0);
      }
    }
  });

  it('face 4 (+Z) maps to positive Z for any UV', () => {
    for (const u of [-1, -0.5, 0, 0.5, 1]) {
      for (const v of [-1, -0.5, 0, 0.5, 1]) {
        const dir = uvToDir(4, u, v);
        expect(dir.z).toBeGreaterThan(0);
      }
    }
  });

  it('face 5 (-Z) maps to negative Z for any UV', () => {
    for (const u of [-1, -0.5, 0, 0.5, 1]) {
      for (const v of [-1, -0.5, 0, 0.5, 1]) {
        const dir = uvToDir(5, u, v);
        expect(dir.z).toBeLessThan(0);
      }
    }
  });

  // I1: Unnormalized uvToDir has varying lengths — the original bug
  it('unnormalized direction at face center has length 1', () => {
    const dir = uvToDir(0, 0, 0); // (1, 0, 0)
    expect(dir.length()).toBeCloseTo(1, 10);
  });

  it('unnormalized direction at face corner has length sqrt(3) — the bug', () => {
    const dir = uvToDir(0, 1, 1); // (1, 1, 1)
    expect(dir.length()).toBeCloseTo(Math.sqrt(3), 10);
  });

  it('unnormalized direction at face edge has length sqrt(2)', () => {
    const dir = uvToDir(0, 0, 1); // (1, 0, 1)
    expect(dir.length()).toBeCloseTo(Math.sqrt(2), 10);
  });

  // Fix verification: normalized direction has length 1 everywhere
  it('normalized direction has unit length at face center', () => {
    const dir = uvToDir(0, 0, 0).normalize();
    expect(dir.length()).toBeCloseTo(1, 10);
  });

  it('normalized direction has unit length at face corner', () => {
    const dir = uvToDir(0, 1, 1).normalize();
    expect(dir.length()).toBeCloseTo(1, 10);
  });

  it('normalized direction has unit length at face edge', () => {
    const dir = uvToDir(0, 0, 1).normalize();
    expect(dir.length()).toBeCloseTo(1, 10);
  });

  // I5: Determinism — same input always produces same output
  it('same (face, u, v) produces identical direction', () => {
    const a = uvToDir(3, 0.35, -0.72);
    const b = uvToDir(3, 0.35, -0.72);
    expect(a.equals(b)).toBe(true);
  });

  // All 6 faces at center produce axis-aligned unit vectors
  it('face 0 center points along +X', () => {
    const dir = uvToDir(0, 0, 0);
    expect(dir.x).toBe(1);
    expect(dir.y).toBe(0);
    expect(dir.z).toBe(0);
  });

  it('face 2 center points along +Y', () => {
    const dir = uvToDir(2, 0, 0);
    expect(dir.x).toBe(0);
    expect(dir.y).toBe(1);
    expect(dir.z).toBe(0);
  });

  it('face 4 center points along +Z', () => {
    const dir = uvToDir(4, 0, 0);
    expect(dir.x).toBe(0);
    expect(dir.y).toBe(0);
    expect(dir.z).toBe(1);
  });

  // Cross-face continuity: same 3D direction from different faces
  it('adjacent faces agree at shared edge', () => {
    // Face 0 (+X) at u=1, v=any: (1, 1, v) — right edge
    // Face 4 (+Z) at u=any, v=1: (u, 1, 1) — top edge
    // At the shared corner: face0(1,1) = (1,1,1), face4(1,1) = (1,1,1)
    const f0 = uvToDir(0, 1, 1).normalize();
    const f4 = uvToDir(4, 1, 1).normalize();
    expect(Vector3.Distance(f0, f4)).toBeLessThan(1e-6);
  });
});

describe('LOD coherence invariant (I6)', () => {
  const R = 6371;
  const heightAmp = 8;
  const res = 16;

  function vertexPos(
    p: LODPlanet,
    faceIdx: number,
    depth: number,
    tx: number,
    ty: number,
    i: number,
    j: number,
  ): Vector3 {
    const step = 1 / (1 << depth);
    const u = (tx + i / res) * step * 2 - 1;
    const v = (ty + j / res) * step * 2 - 1;
    const dir = uvToDir(faceIdx, u, v).normalize();
    const samplePos = new Vector3(dir.x * R, dir.y * R, dir.z * R);
    const h = p.getHeightAt(samplePos);
    return new Vector3(dir.x * (R + h * heightAmp), dir.y * (R + h * heightAmp), dir.z * (R + h * heightAmp));
  }

  // I6: For any vertex shared between a parent chunk at depth d
  // and a child chunk at depth d+1, the 3D position must be identical.
  // This ensures LOD transitions don't create cracks or flying chunks.
  it('parent center matches all 4 children at shared corner', () => {
    const p = new LODPlanet({ seed: 42, heightAmplitude: heightAmp });
    const face = 0, depth = 3, tx = 0, ty = 0;

    const center = vertexPos(p, face, depth, tx, ty, res / 2, res / 2);

    // Child (2*tx, 2*ty) bottom-right corner = parent center
    const c00 = vertexPos(p, face, depth + 1, 2 * tx, 2 * ty, res, res);
    // Child (2*tx+1, 2*ty) bottom-left corner = parent center
    const c10 = vertexPos(p, face, depth + 1, 2 * tx + 1, 2 * ty, 0, res);
    // Child (2*tx, 2*ty+1) top-right corner = parent center
    const c01 = vertexPos(p, face, depth + 1, 2 * tx, 2 * ty + 1, res, 0);
    // Child (2*tx+1, 2*ty+1) top-left corner = parent center
    const c11 = vertexPos(p, face, depth + 1, 2 * tx + 1, 2 * ty + 1, 0, 0);

    expect(Vector3.Distance(center, c00)).toBeLessThan(1e-6);
    expect(Vector3.Distance(center, c10)).toBeLessThan(1e-6);
    expect(Vector3.Distance(center, c01)).toBeLessThan(1e-6);
    expect(Vector3.Distance(center, c11)).toBeLessThan(1e-6);

    // All children agree at shared corner
    expect(Vector3.Distance(c00, c10)).toBeLessThan(1e-6);
    expect(Vector3.Distance(c00, c01)).toBeLessThan(1e-6);
    expect(Vector3.Distance(c00, c11)).toBeLessThan(1e-6);

    p.dispose();
  });

  it('parent corners match child corners', () => {
    const p = new LODPlanet({ seed: 42, heightAmplitude: heightAmp });
    const face = 0, depth = 3, tx = 1, ty = 2;

    // Parent top-left = child(2*tx, 2*ty) top-left
    const p_tl = vertexPos(p, face, depth, tx, ty, 0, 0);
    const c_tl = vertexPos(p, face, depth + 1, 2 * tx, 2 * ty, 0, 0);
    expect(Vector3.Distance(p_tl, c_tl)).toBeLessThan(1e-6);

    // Parent top-right (i=res, j=0) = child(2*tx+1, 2*ty) top-right (i=res, j=0)
    const p_tr = vertexPos(p, face, depth, tx, ty, res, 0);
    const c_tr = vertexPos(p, face, depth + 1, 2 * tx + 1, 2 * ty, res, 0);
    expect(Vector3.Distance(p_tr, c_tr)).toBeLessThan(1e-6);

    // Parent bottom-left (i=0, j=res) = child(2*tx, 2*ty+1) bottom-left (i=0, j=res)
    const p_bl = vertexPos(p, face, depth, tx, ty, 0, res);
    const c_bl = vertexPos(p, face, depth + 1, 2 * tx, 2 * ty + 1, 0, res);
    expect(Vector3.Distance(p_bl, c_bl)).toBeLessThan(1e-6);

    // Parent bottom-right (i=res, j=res) = child(2*tx+1, 2*ty+1) bottom-right (i=res, j=res)
    const p_br = vertexPos(p, face, depth, tx, ty, res, res);
    const c_br = vertexPos(p, face, depth + 1, 2 * tx + 1, 2 * ty + 1, res, res);
    expect(Vector3.Distance(p_br, c_br)).toBeLessThan(1e-6);

    p.dispose();
  });

  it('parent edge midpoints match child shared edges', () => {
    const p = new LODPlanet({ seed: 42, heightAmplitude: heightAmp });
    const face = 0, depth = 3, tx = 0, ty = 0;

    // Top edge midpoint: parent (i=res/2, j=0)
    // = child(2*tx, 2*ty) top-right (i=res, j=0)
    // = child(2*tx+1, 2*ty) top-left (i=0, j=0)
    const p_top = vertexPos(p, face, depth, tx, ty, res / 2, 0);
    const c0_top = vertexPos(p, face, depth + 1, 2 * tx, 2 * ty, res, 0);
    const c1_top = vertexPos(p, face, depth + 1, 2 * tx + 1, 2 * ty, 0, 0);
    expect(Vector3.Distance(p_top, c0_top)).toBeLessThan(1e-6);
    expect(Vector3.Distance(p_top, c1_top)).toBeLessThan(1e-6);
    expect(Vector3.Distance(c0_top, c1_top)).toBeLessThan(1e-6);

    p.dispose();
  });

  it('coherence holds on all 6 faces', () => {
    const p = new LODPlanet({ seed: 42, heightAmplitude: heightAmp });
    const depth = 3;

    for (let face = 0; face < 6; face++) {
      const parent = vertexPos(p, face, depth, 0, 0, res / 2, res / 2);
      const child = vertexPos(p, face, depth + 1, 0, 0, res, res);
      expect(Vector3.Distance(parent, child)).toBeLessThan(1e-6);
    }

    p.dispose();
  });

  it('coherence holds across face boundaries (I7)', () => {
    const p = new LODPlanet({ seed: 42, heightAmplitude: heightAmp });
    const depth = 3;

    // At depth=3, tx=7, ty=7 gives UV range [0.75, 1] → corner at (1, 1)
    // Face 0 (+X, u=1, v=1) → (1, 1, 1) in cube space
    // Face 2 (+Y, u=1, v=1) → (1, 1, 1) in cube space
    // Face 4 (+Z, u=1, v=1) → (1, 1, 1) in cube space
    const f0_corner = vertexPos(p, 0, depth, 7, 7, res, res);
    const f2_corner = vertexPos(p, 2, depth, 7, 7, res, res);
    const f4_corner = vertexPos(p, 4, depth, 7, 7, res, res);
    expect(Vector3.Distance(f0_corner, f2_corner)).toBeLessThan(1e-6);
    expect(Vector3.Distance(f0_corner, f4_corner)).toBeLessThan(1e-6);
    expect(Vector3.Distance(f2_corner, f4_corner)).toBeLessThan(1e-6);

    p.dispose();
  });
});

describe('LODPlanet height invariants', () => {
  it('getHeightAt returns values in [0, 1] for sphere-surface positions', () => {
    const p = new LODPlanet({ seed: 42, heightAmplitude: 8 });
    const R = 6371;
    const positions = [
      new Vector3(R, 0, 0),
      new Vector3(0, R, 0),
      new Vector3(0, 0, R),
      new Vector3(R / Math.sqrt(3), R / Math.sqrt(3), R / Math.sqrt(3)),
    ];
    for (const pos of positions) {
      const h = p.getHeightAt(pos);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
    p.dispose();
  });

  it('height at face center is consistent across all 6 faces', () => {
    const p = new LODPlanet({ seed: 42, heightAmplitude: 8 });
    const R = 6371;
    const centers = [
      new Vector3(R, 0, 0),
      new Vector3(-R, 0, 0),
      new Vector3(0, R, 0),
      new Vector3(0, -R, 0),
      new Vector3(0, 0, R),
      new Vector3(0, 0, -R),
    ];
    const heights = centers.map(pos => p.getHeightAt(pos));
    for (const h of heights) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
    p.dispose();
  });
});
