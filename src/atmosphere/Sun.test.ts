import { describe, it, expect, vi } from 'vitest';
import { Sun } from './Sun';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

vi.mock('@babylonjs/core/Lights/directionalLight', () => ({
  DirectionalLight: vi.fn().mockImplementation(function () {
    return {
      intensity: 0,
      diffuse: {},
      position: { copyFrom: vi.fn() },
      setDirectionToTarget: vi.fn(),
      setEnabled: vi.fn(),
      dispose: vi.fn(),
    };
  }),
}));

vi.mock('@babylonjs/core/Lights/hemisphericLight', () => ({
  HemisphericLight: vi.fn().mockImplementation(function () {
    return {
      intensity: 0,
      diffuse: { copyFrom: vi.fn() },
      groundColor: { copyFrom: vi.fn() },
      direction: { copyFrom: vi.fn() },
      setEnabled: vi.fn(),
      dispose: vi.fn(),
    };
  }),
}));

vi.mock('@babylonjs/core/Materials/standardMaterial', () => ({
  StandardMaterial: vi.fn().mockImplementation(function () {
    return {
      emissiveColor: null,
      emissiveIntensity: 0,
      disableLighting: false,
      dispose: vi.fn(),
    };
  }),
}));

vi.mock('@babylonjs/core/Meshes/meshBuilder', () => ({
  MeshBuilder: {
    CreateSphere: vi.fn(() => ({
      position: { copyFrom: vi.fn() },
      material: null,
      dispose: vi.fn(),
    })),
  },
}));

describe('Sun', () => {
  it('creates with default config', () => {
    const sun = new Sun({} as any);
    expect(sun).toBeDefined();
    sun.dispose();
  });

  it('accepts custom inclination', () => {
    const sun = new Sun({} as any, { inclination: 0.8 });
    expect(sun).toBeDefined();
    sun.dispose();
  });

  it('getDirection returns Vector3', () => {
    const sun = new Sun({} as any);
    expect(sun.getDirection()).toBeInstanceOf(Vector3);
    sun.dispose();
  });

  it('direction is normalized at construction', () => {
    const sun = new Sun({} as any);
    expect(sun.getDirection().length()).toBeCloseTo(1, 5);
    sun.dispose();
  });

  it('direction is constant (static sun, no orbital motion)', () => {
    const sun = new Sun({} as any);
    const dirBefore = sun.getDirection().clone();
    for (let i = 0; i < 200; i++) {
      sun.update(0.5);
    }
    const dirAfter = sun.getDirection().clone();
    expect(Vector3.Distance(dirBefore, dirAfter)).toBe(0);
    sun.dispose();
  });

  it('dispose does not throw', () => {
    const sun = new Sun({} as any);
    expect(() => sun.dispose()).not.toThrow();
    expect(() => sun.dispose()).not.toThrow();
  });

  // Skipped: require real Babylon.js Scene for Light/Mesh creation
  it.skip('getLight returns DirectionalLight', () => {});
  it.skip('getHemisphere returns HemisphericLight', () => {});
  it.skip('getSunSphere returns Mesh with emissive material', () => {});
  it.skip('sun sphere has positive size', () => {});
  it.skip('directional light has warm white color', () => {});
  it.skip('hemisphere light has sky and ground colors', () => {});
});
