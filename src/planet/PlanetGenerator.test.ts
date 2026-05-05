import { describe, it, expect } from 'vitest';
import { PlanetGenerator } from './PlanetGenerator';

describe('PlanetGenerator', () => {
  it('creates a mesh with default config', () => {
    const gen = new PlanetGenerator();
    const mesh = gen.generate();
    expect(mesh).toBeDefined();
    expect(mesh.geometry).toBeDefined();
    expect(mesh.geometry.attributes.position).toBeDefined();
    gen.dispose();
  });

  it('uses custom radius', () => {
    const gen = new PlanetGenerator({ radius: 25 });
    const mesh = gen.generate();
    const pos = mesh.geometry.attributes.position;
    const maxR = Math.max(
      ...Array.from({ length: pos.count }, (_, i) => {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        return Math.sqrt(x * x + y * y + z * z);
      })
    );
    expect(maxR).toBeGreaterThanOrEqual(25);
    gen.dispose();
  });

  it('clamps low segments to 4', () => {
    const gen = new PlanetGenerator({ segments: 2 });
    const mesh = gen.generate();
    expect(mesh.geometry.attributes.position.count).toBeGreaterThan(10);
    gen.dispose();
  });

  it('fallbacks radius to 1 when 0', () => {
    const gen = new PlanetGenerator({ radius: 0 });
    const mesh = gen.generate();
    const pos = mesh.geometry.attributes.position;
    const hasNonZero = Array.from({ length: pos.count }, (_, i) =>
      Math.abs(pos.getX(i)) + Math.abs(pos.getY(i)) + Math.abs(pos.getZ(i))
    ).some(v => v > 0);
    expect(hasNonZero).toBe(true);
    gen.dispose();
  });

  it('regenerate creates a fresh geometry', () => {
    const gen = new PlanetGenerator({ seed: 42 });
    gen.generate();
    gen.regenerate();
    const mesh = gen.generate();
    expect(mesh.geometry.attributes.position.count).toBeGreaterThan(0);
    gen.dispose();
  });

  it('dispose cleans up resources', () => {
    const gen = new PlanetGenerator();
    gen.generate();
    gen.dispose();
    expect(() => gen.dispose()).not.toThrow();
  });

  it('getHeightAt returns a number', () => {
    const gen = new PlanetGenerator({ seed: 42 });
    gen.generate();
    const h = gen.getHeightAt(0, 0);
    expect(typeof h).toBe('number');
    gen.dispose();
  });

  it('clamps lat/lon out of range in getHeightAt', () => {
    const gen = new PlanetGenerator({ seed: 42 });
    gen.generate();
    expect(() => gen.getHeightAt(100, 0)).not.toThrow();
    expect(() => gen.getHeightAt(0, 500)).not.toThrow();
    gen.dispose();
  });
});
