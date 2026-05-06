import { describe, it, expect } from 'vitest';
import { Sun } from './Sun';
import { DirectionalLight, HemisphereLight, Sprite, Vector3, SpriteMaterial } from 'three';

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
    for (let i = 0; i < 200; i++) {
      sun.update(1);
    }
    const dirAfter = sun.getDirection().clone();
    expect(dirBefore.distanceTo(dirAfter)).toBeGreaterThan(0.01);
    sun.dispose();
  });

  it('update wraps around (full rotation completes)', () => {
    const sun = new Sun();
    sun.update(0);
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
    sun.update(0);
    const y = sun.getDirection().y;
    const expectedBase = 0.3 + 0.7 * Math.max(0, y);
    expect(sun.getLight().intensity).toBeCloseTo(1.5 * expectedBase, 2);
    sun.dispose();
  });

  it('hemisphere intensity changes with sun height', () => {
    const sun = new Sun();
    sun.update(0);
    const initial = sun.getHemisphere().intensity;
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
    sun.getSunSprite();
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

  it('sun sprite has depthTest enabled', () => {
    const sun = new Sun();
    const mat = sun.getSunSprite().material as SpriteMaterial;
    expect(mat.depthTest).toBe(true);
    sun.dispose();
  });

  it('sun sprite has renderOrder 2', () => {
    const sun = new Sun();
    expect(sun.getSunSprite().renderOrder).toBe(2);
    sun.dispose();
  });

  it('directional light has shadow enabled', () => {
    const sun = new Sun();
    expect(sun.getLight().castShadow).toBe(true);
    sun.dispose();
  });

  it('shadow map size is configured', () => {
    const sun = new Sun();
    const shadow = sun.getLight().shadow;
    expect(shadow.mapSize.width).toBeGreaterThan(0);
    expect(shadow.mapSize.height).toBeGreaterThan(0);
    sun.dispose();
  });

  it('shadow camera has orthographic frustum configured', () => {
    const sun = new Sun();
    const cam = sun.getLight().shadow.camera;
    expect(isFinite(cam.left)).toBe(true);
    expect(isFinite(cam.right)).toBe(true);
    expect(isFinite(cam.top)).toBe(true);
    expect(isFinite(cam.bottom)).toBe(true);
    expect(cam.right - cam.left).toBeGreaterThan(0);
    expect(cam.top - cam.bottom).toBeGreaterThan(0);
    sun.dispose();
  });

  it('dispose does not throw', () => {
    const sun = new Sun();
    expect(() => sun.dispose()).not.toThrow();
    expect(() => sun.dispose()).not.toThrow();
  });
});
