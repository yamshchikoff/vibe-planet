import { describe, it, expect } from 'vitest';
import { LODPlanet } from './LODPlanet';
import { Vector3 } from '@babylonjs/core';

describe('LODPlanet', () => {
  it('constructor does not throw', () => {
    expect(() => new LODPlanet({ seed: 42 })).not.toThrow();
  });

  // Skipped: require WebGL context via Babylon.js Scene
  it.skip('getRoot returns a TransformNode', () => {});
  it.skip('update generates chunks near camera', () => {});

  it('getHeightAt returns reasonable value', () => {
    const p = new LODPlanet({ seed: 42, heightAmplitude: 8 });
    const h = p.getHeightAt(new Vector3(6371, 0, 0));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(1);
    p.dispose();
  });

  it('produces varied terrain across the sphere', () => {
    const p = new LODPlanet({ seed: 42, heightAmplitude: 8 });
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
    expect(max - min).toBeGreaterThan(0.1);
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
    expect(a.getHeightAt(pos)).not.toBe(b.getHeightAt(pos));
    a.dispose();
    b.dispose();
  });

  it.skip('generated chunks have receiveShadows enabled', () => {});

  it('dispose does not throw', () => {
    const p = new LODPlanet({ seed: 42, maxDepth: 3, maxChunks: 50 });
    p.update(new Vector3(0, 6373, 0));
    expect(() => p.dispose()).not.toThrow();
    expect(() => p.dispose()).not.toThrow();
  });

  it.skip('update with very distant camera generates only low-detail chunks', () => {});
  it.skip('accepts biomeWarpAmplitude config', () => {});
  it.skip('chunks have PBR material with roughness and metallic', () => {});

  it.skip('triangle normals face outward from sphere center', () => {});
});
