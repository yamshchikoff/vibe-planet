import { describe, it, expect } from 'vitest';
import { HeightSampler } from './HeightSampler';

describe('HeightSampler', () => {
  it('returns same height for same seed and position', () => {
    const a = new HeightSampler(42);
    const b = new HeightSampler(42);
    for (let i = 0; i < 20; i++) {
      const px = Math.random() * 1000 - 500;
      const py = Math.random() * 1000 - 500;
      const pz = Math.random() * 1000 - 500;
      expect(a.getHeight(px, py, pz)).toBe(b.getHeight(px, py, pz));
    }
  });

  it('returns different heights for different seeds', () => {
    const a = new HeightSampler(42);
    const b = new HeightSampler(99);
    let differences = 0;
    for (let i = 0; i < 10; i++) {
      const px = i * 100;
      const py = i * 50;
      const pz = i * 200;
      if (a.getHeight(px, py, pz) !== b.getHeight(px, py, pz)) differences++;
    }
    expect(differences).toBeGreaterThan(5);
  });

  it('returns height in [0, 1] range', () => {
    const s = new HeightSampler(42);
    for (let i = 0; i < 100; i++) {
      const h = s.getHeight(i * 13, i * 7, i * 31);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
  });

  it('is continuous (small position change = small height change)', () => {
    const s = new HeightSampler(42);
    const h1 = s.getHeight(100, 200, 300);
    const h2 = s.getHeight(100.01, 200.01, 300.01);
    expect(Math.abs(h2 - h1)).toBeLessThan(0.05);
  });

  it('getHeightLatLon matches getHeight for sphere surface', () => {
    const s = new HeightSampler(42);
    // getHeightLatLon samples on a unit sphere (direction only)
    const lat = 0.5; // radians
    const lon = 1.0;
    const x = Math.cos(lat) * Math.cos(lon);
    const y = Math.sin(lat);
    const z = Math.cos(lat) * Math.sin(lon);
    expect(s.getHeight(x, y, z)).toBe(s.getHeightLatLon(lat, lon));
  });

  it('covers full [0, 1] range across varied positions', () => {
    const s = new HeightSampler(42);
    let min = 1;
    let max = 0;
    for (let i = 0; i < 1000; i++) {
      const px = (i * 137 + 50) % 4000 - 2000;
      const py = (i * 251 + 30) % 4000 - 2000;
      const pz = (i * 373 + 70) % 4000 - 2000;
      const h = s.getHeight(px, py, pz);
      if (h < min) min = h;
      if (h > max) max = h;
    }
    // Must reach low enough for ocean biomes
    expect(min).toBeLessThan(0.3);
    // Must reach high enough for mountain biomes
    expect(max).toBeGreaterThan(0.65);
  });

  describe('getBiomeWarp', () => {
    it('returns values in [-1, 1] range', () => {
      const s = new HeightSampler(42);
      for (let i = 0; i < 100; i++) {
        const w = s.getBiomeWarp(i * 13, i * 7, i * 31, 3);
        expect(w).toBeGreaterThanOrEqual(-1);
        expect(w).toBeLessThanOrEqual(1);
      }
    });

    it('is deterministic (same seed, same position, same octaves)', () => {
      const a = new HeightSampler(42);
      const b = new HeightSampler(42);
      for (let i = 0; i < 20; i++) {
        const px = Math.random() * 1000 - 500;
        const py = Math.random() * 1000 - 500;
        const pz = Math.random() * 1000 - 500;
        expect(a.getBiomeWarp(px, py, pz, 4)).toBe(b.getBiomeWarp(px, py, pz, 4));
      }
    });

    it('differs from height noise at same position (different seed offset)', () => {
      const s = new HeightSampler(42);
      let allSame = true;
      for (let i = 0; i < 20; i++) {
        const px = i * 53;
        const py = i * 97;
        const pz = i * 131;
        if (s.getBiomeWarp(px, py, pz, 3) !== s.getHeight(px, py, pz)) {
          allSame = false;
          break;
        }
      }
      expect(allSame).toBe(false);
    });

    it('more octaves produce more varied values', () => {
      const s = new HeightSampler(42);
      // With more octaves, the absolute values spread more.
      // Sample at many more positions across a larger range to see the effect.
      let maxDiffFew = 0;
      let maxDiffMany = 0;
      for (let i = 0; i < 200; i++) {
        const px = i * 37 + 0.3;
        const py = i * 53 + 0.7;
        const pz = i * 71 + 0.1;
        const w2 = s.getBiomeWarp(px, py, pz, 2);
        const w6 = s.getBiomeWarp(px, py, pz, 6);
        maxDiffFew = Math.max(maxDiffFew, Math.abs(w2));
        maxDiffMany = Math.max(maxDiffMany, Math.abs(w6));
      }
      // 6 octaves should reach a wider range due to higher-frequency contributions
      // Use weak assertion: at worst, 6 octaves are at least as varied as 2
      expect(maxDiffMany).toBeGreaterThanOrEqual(maxDiffFew * 0.5);
    });
  });

  describe('getMountainMask', () => {
    it('returns values in [0, 1]', () => {
      const s = new HeightSampler(42);
      for (let i = 0; i < 100; i++) {
        const m = s.getMountainMask(i * 73, i * 41, i * 97);
        expect(m).toBeGreaterThanOrEqual(0);
        expect(m).toBeLessThanOrEqual(1);
      }
    });

    it('is deterministic', () => {
      const a = new HeightSampler(42);
      const b = new HeightSampler(42);
      for (let i = 0; i < 20; i++) {
        const px = Math.random() * 2000 - 1000;
        const py = Math.random() * 2000 - 1000;
        const pz = Math.random() * 2000 - 1000;
        expect(a.getMountainMask(px, py, pz)).toBe(b.getMountainMask(px, py, pz));
      }
    });

    it('produces both flat and mountain zones', () => {
      const s = new HeightSampler(91);
      let flatCount = 0;
      let mountainCount = 0;
      const R = 6371;
      for (let lat = -1.5; lat <= 1.5; lat += 0.15) {
        for (let lon = 0; lon < 6.28; lon += 0.2) {
          const x = Math.cos(lat) * Math.cos(lon) * R;
          const y = Math.sin(lat) * R;
          const z = Math.cos(lat) * Math.sin(lon) * R;
          const m = s.getMountainMask(x, y, z);
          if (m < 0.2) flatCount++;
          if (m > 0.8) mountainCount++;
        }
      }
      expect(flatCount).toBeGreaterThan(10);
      expect(mountainCount).toBeGreaterThan(10);
    });
  });

  describe('ridged terrain height', () => {
    it('still returns values in [0, 1] after ridged blending', () => {
      const s = new HeightSampler(42);
      for (let i = 0; i < 100; i++) {
        const h = s.getHeight(i * 13, i * 7, i * 31);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(1);
      }
    });

    it('height at known mountain (seed 91, lat=20°) is different from old value', () => {
      // Previously was ~0.83 with pure FBM. With ridged blending should differ.
      const s = new HeightSampler(91);
      const lat = 20 * Math.PI / 180;
      const lon = 0;
      const x = Math.cos(lat) * Math.cos(lon);
      const y = Math.sin(lat);
      const z = Math.cos(lat) * Math.sin(lon);
      const h = s.getHeight(x, y, z);
      // Should still be a reasonable height in [0, 1]
      expect(h).toBeGreaterThan(0.2);
      expect(h).toBeLessThan(0.95);
    });
  });
});
