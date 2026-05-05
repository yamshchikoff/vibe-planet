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
});
