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
      setEnabled: vi.fn(),
      dispose: vi.fn(),
    };
  }),
}));

vi.mock('@babylonjs/core/Materials/standardMaterial', () => ({
  StandardMaterial: vi.fn().mockImplementation(function () {
    return {
      opacityTexture: null,
      emissiveTexture: null,
      diffuseTexture: null,
      disableLighting: false,
      dispose: vi.fn(),
    };
  }),
}));

vi.mock('@babylonjs/core/Materials/Textures/texture', () => ({
  Texture: {
    LoadFromDataString: vi.fn(() => ({ hasAlpha: true, dispose: vi.fn() })),
  },
}));

vi.mock('@babylonjs/core/Meshes/meshBuilder', () => ({
  MeshBuilder: {
    CreatePlane: vi.fn(() => ({
      billboardMode: 0,
      scaling: { set: vi.fn() },
      position: { copyFrom: vi.fn() },
      material: null,
      renderingGroupId: 0,
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

  it('update changes direction over time', () => {
    const sun = new Sun({} as any);
    const dirBefore = sun.getDirection().clone();
    for (let i = 0; i < 200; i++) {
      sun.update(1);
    }
    const dirAfter = sun.getDirection().clone();
    expect(Vector3.Distance(dirBefore, dirAfter)).toBeGreaterThan(0.01);
    sun.dispose();
  });

  it('update wraps around (full rotation completes)', () => {
    const sun = new Sun({} as any);
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
    expect(Vector3.Distance(dirInitial, dirFinal)).toBeLessThan(0.01);
    sun.dispose();
  });

  it('direction vector is always normalized', () => {
    const sun = new Sun({} as any);
    for (let i = 0; i < 50; i++) {
      sun.update(0.5);
      const len = sun.getDirection().length();
      expect(len).toBeCloseTo(1, 5);
    }
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
  it.skip('getSunDisc returns Mesh with billboard mode', () => {});
  it.skip('light intensity varies with sun height', () => {});
  it.skip('hemisphere intensity changes with sun height', () => {});
  it.skip('sun disc has positive size', () => {});
  it.skip('directional light has warm white color', () => {});
  it.skip('hemisphere light has sky and ground colors', () => {});
});
