import { describe, it, expect } from 'vitest';
import { Sun } from './Sun';
import { DirectionalLight, HemisphereLight, Sprite, Vector3 } from 'three';

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

  it('getHemisphere returns HemisphereLight', () => {
    const sun = new Sun();
    expect(sun.getHemisphere()).toBeInstanceOf(HemisphereLight);
    sun.dispose();
  });

  it('getSunSprite returns Sprite', () => {
    const sun = new Sun();
    const sprite = sun.getSunSprite();
    expect(sprite).toBeInstanceOf(Sprite);
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
    sun.update(0); // initialize direction
    const angularSpeed = 0.05;
    const totalAngle = Math.PI * 2;
    const steps = 200;
    const dtPerStep = totalAngle / angularSpeed / steps;
    const dirInitial = sun.getDirection().clone();
    for (let i = 0; i < steps; i++) {
      sun.update(dtPerStep);
    }
    const dirFinal = sun.getDirection().clone();
    expect(dirInitial.distanceTo(dirFinal)).toBeLessThan(0.01);
    sun.dispose();
  });

  it('light intensity varies with sun height above horizon', () => {
    const sun = new Sun();
    sun.update(0); // initialize direction and intensity
    const y = sun.getDirection().y;
    const expectedBase = 0.3 + 0.7 * Math.max(0, y);
    expect(sun.getLight().intensity).toBeCloseTo(1.5 * expectedBase, 2);
    sun.dispose();
  });

  it('hemisphere intensity changes with sun height', () => {
    const sun = new Sun();
    sun.update(0);
    const initial = sun.getHemisphere().intensity;
    // Night: sun below horizon
    expect(initial).toBeGreaterThanOrEqual(0.12);
    expect(initial).toBeLessThanOrEqual(0.40);
    sun.dispose();
  });

  it('sun sprite has positive scale', () => {
    const sun = new Sun();
    const s = sun.getSunSprite().scale;
    expect(s.x).toBeGreaterThan(0);
    expect(s.y).toBeGreaterThan(0);
    sun.dispose();
  });

  it('sun sprite position updates after update call', () => {
    const sun = new Sun();
    sun.update(0);
    const pos = sun.getSunSprite().position;
    expect(pos.length()).toBeGreaterThan(0);
    sun.dispose();
  });

  it('directional light has warm white color', () => {
    const sun = new Sun();
    const color = sun.getLight().color;
    expect(color.getHex()).toBe(0xfff5e6);
    sun.dispose();
  });

  it('hemisphere light has sky and ground colors', () => {
    const sun = new Sun();
    const hemi = sun.getHemisphere();
    expect(hemi.color).toBeDefined();
    expect(hemi.groundColor).toBeDefined();
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
