import { describe, it, expect } from 'vitest';
import { LODPlanet } from './LODPlanet';
import { Vector3 } from 'three';

describe('LODPlanet', () => {
  it('constructor does not throw', () => {
    expect(() => new LODPlanet({ seed: 42 })).not.toThrow();
  });

  it('getMesh returns a Group', () => {
    const p = new LODPlanet({ seed: 42 });
    const g = p.getMesh();
    expect(g.type).toBe('Group');
    p.dispose();
  });

  it('update generates chunks near camera', () => {
    const p = new LODPlanet({ seed: 42, maxDepth: 4, maxChunks: 100 });
    // Camera near the surface
    const camPos = new Vector3(0, 6373, 0);
    p.update(camPos);
    expect(p.getMesh().children.length).toBeGreaterThan(0);
    p.dispose();
  });

  it('getHeightAt returns reasonable value', () => {
    const p = new LODPlanet({ seed: 42, heightAmplitude: 8 });
    const h = p.getHeightAt(new Vector3(6371, 0, 0));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(1);
    p.dispose();
  });

  it('produces varied terrain across the sphere', () => {
    const p = new LODPlanet({ seed: 42, heightAmplitude: 8 });
    // Sample across the sphere — expect diverse height values
    const values: number[] = [];
    for (let i = 0; i < 50; i++) {
      const theta = (i * 0.5) % (Math.PI * 2);
      const phi = (i * 0.3) % Math.PI;
      const pos = new Vector3(
        6371 * Math.sin(phi) * Math.cos(theta),
        6371 * Math.cos(phi),
        6371 * Math.sin(phi) * Math.sin(theta)
      );
      values.push(p.getHeightAt(pos));
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    // Expect at least some variation
    expect(max - min).toBeGreaterThan(0.1);
    // And all values in [0, 1]
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
    p.dispose();
  });

  it('same seed generates same height', () => {
    const a = new LODPlanet({ seed: 42 });
    const b = new LODPlanet({ seed: 42 });
    const pos = new Vector3(6371, 0, 0);
    expect(a.getHeightAt(pos)).toBe(b.getHeightAt(pos));
    a.dispose();
    b.dispose();
  });

  it('different seeds generate different heights', () => {
    const a = new LODPlanet({ seed: 42 });
    const b = new LODPlanet({ seed: 99 });
    const pos = new Vector3(6371, 0, 0);
    // Very unlikely to be exactly the same with different seeds
    expect(a.getHeightAt(pos)).not.toBe(b.getHeightAt(pos));
    a.dispose();
    b.dispose();
  });

  it('dispose does not throw', () => {
    const p = new LODPlanet({ seed: 42, maxDepth: 3, maxChunks: 50 });
    p.update(new Vector3(0, 6373, 0));
    expect(() => p.dispose()).not.toThrow();
    expect(() => p.dispose()).not.toThrow(); // double dispose
  });

  it('update with very distant camera generates only low-detail chunks', () => {
    const p = new LODPlanet({ seed: 42, maxDepth: 8, maxChunks: 200 });
    // Camera very far (10x radius)
    p.update(new Vector3(0, 63710, 0));
    const count = p.getMesh().children.length;
    expect(count).toBeGreaterThan(0);
    // At this distance, should have fewer chunks than close-up
    const p2 = new LODPlanet({ seed: 42, maxDepth: 8, maxChunks: 200 });
    p2.update(new Vector3(0, 6373, 0));
    const closeCount = p2.getMesh().children.length;
    expect(closeCount).toBeGreaterThanOrEqual(count);
    p.dispose();
    p2.dispose();
  });
});
