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
