import { describe, it, expect } from 'vitest';
import { Sun } from './Sun';
import { DirectionalLight, AmbientLight, Vector3 } from 'three';

describe('Sun', () => {
  it('creates with default config', () => {
    const sun = new Sun();
    expect(sun).toBeDefined();
    sun.dispose();
  });

  it('accepts custom inclination', () => {
    const sun = new Sun({ inclination: 0.8 });
    expect(sun).toBeDefined();
    sun.dispose();
  });

  it('accepts custom longitude', () => {
    const sun = new Sun({ longitude: 1.2 });
    expect(sun).toBeDefined();
    sun.dispose();
  });

  it('getLight returns DirectionalLight', () => {
    const sun = new Sun();
    expect(sun.getLight()).toBeInstanceOf(DirectionalLight);
    sun.dispose();
  });

  it('getAmbient returns AmbientLight', () => {
    const sun = new Sun();
    expect(sun.getAmbient()).toBeInstanceOf(AmbientLight);
    sun.dispose();
  });

  it('getDirection returns Vector3', () => {
    const sun = new Sun();
    expect(sun.getDirection()).toBeInstanceOf(Vector3);
    sun.dispose();
  });

  it('update changes direction over time', () => {
    const sun = new Sun();
    const dirBefore = sun.getDirection().clone();
    // Advance time significantly
    for (let i = 0; i < 200; i++) {
      sun.update(1);
    }
    const dirAfter = sun.getDirection().clone();
    // Direction should have rotated from initial position
    expect(dirBefore.distanceTo(dirAfter)).toBeGreaterThan(0.01);
    sun.dispose();
  });

  it('update wraps around (full rotation completes)', () => {
    const sun = new Sun();
    // Record direction after one full cycle
    const fullRotation = (Math.PI * 2) / 0.05; // dt needed for angle to reach 2π
    const dirInitial = sun.getDirection().clone();
    for (let i = 0; i < Math.ceil(fullRotation); i++) {
      sun.update(1);
    }
    const dirFinal = sun.getDirection().clone();
    // Should be close to initial (full cycle)
    expect(dirInitial.distanceTo(dirFinal)).toBeLessThan(0.01);
    sun.dispose();
  });

  it('light intensity varies with sun height above horizon', () => {
    const sun = new Sun();
    const y = sun.getDirection().y;
    const expectedBase = 0.3 + 0.7 * Math.max(0, y);
    // Intensity = 1.5 * (0.3 + 0.7 * max(0, sun.y_direction))
    expect(sun.getLight().intensity).toBeCloseTo(1.5 * expectedBase, 2);
    sun.dispose();
  });

  it('ambient intensity stays above minimum at all times', () => {
    const sun = new Sun();
    // min ambient = 0.2 (when sun is below horizon)
    expect(sun.getAmbient().intensity).toBeGreaterThanOrEqual(0.2);
    sun.dispose();
  });

  it('directional light has warm white color', () => {
    const sun = new Sun();
    const color = sun.getLight().color;
    expect(color.getHex()).toBe(0xfff5e6);
    sun.dispose();
  });

  it('ambient light has blue-tinted color', () => {
    const sun = new Sun();
    const color = sun.getAmbient().color;
    expect(color.getHex()).toBe(0x8899bb);
    sun.dispose();
  });

  it('direction vector is always normalized', () => {
    const sun = new Sun();
    for (let i = 0; i < 50; i++) {
      sun.update(0.5);
      const len = sun.getDirection().length();
      expect(len).toBeCloseTo(1, 5);
    }
    sun.dispose();
  });

  it('dispose does not throw', () => {
    const sun = new Sun();
    expect(() => sun.dispose()).not.toThrow();
    expect(() => sun.dispose()).not.toThrow(); // double dispose
  });
});
