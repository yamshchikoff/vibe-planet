import { describe, it, expect, vi } from 'vitest';
import { Atmosphere } from './Atmosphere';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

vi.mock('@babylonjs/core/Materials/shaderMaterial', () => ({
  ShaderMaterial: vi.fn().mockImplementation(function () {
    const uniforms: Record<string, any> = {};
    return {
      setVector3: vi.fn(function (name: string, value: any) { uniforms[name] = value; }),
      setFloats: vi.fn(),
      setColor3: vi.fn(),
      backFaceCulling: true,
      sideOrientation: 0,
      dispose: vi.fn(),
      _uniforms: uniforms,
    };
  }),
}));

vi.mock('@babylonjs/core/Materials/material', () => ({
  Material: { ClockWiseSideOrientation: 1, CounterClockWiseSideOrientation: 0 },
}));

vi.mock('@babylonjs/core/Meshes/meshBuilder', () => ({
  MeshBuilder: {
    CreateSphere: vi.fn(() => ({
      position: { set: vi.fn() },
      material: null,
      renderingGroupId: 0,
      dispose: vi.fn(),
    })),
  },
}));

describe('Atmosphere', () => {
  const defaultConfig = { planetRadius: 6371, atmosphereHeight: 80 };
  const mockScene = {} as any;

  it('creates with config', () => {
    const atmo = new Atmosphere(defaultConfig, mockScene);
    expect(atmo).toBeDefined();
    atmo.dispose();
  });

  it('update sets sunDirection uniform', () => {
    const atmo = new Atmosphere(defaultConfig, mockScene);
    const sunDir = new Vector3(0.5, 0.7, 0.3).normalize();
    const camPos = new Vector3(0, 6373, 0);
    atmo.update(camPos, sunDir);
    // ShaderMaterial is mocked; verify via the mock
    const mat = (atmo.getMesh().material as any);
    expect(mat.setVector3).toHaveBeenCalledWith('sunDirection', sunDir);
    atmo.dispose();
  });

  it('update sets planetCenter uniform to negated camera position', () => {
    const atmo = new Atmosphere(defaultConfig, mockScene);
    const sunDir = new Vector3(1, 0, 0);
    const camPos = new Vector3(150, 6375, -200);
    atmo.update(camPos, sunDir);
    const mat = (atmo.getMesh().material as any);
    // planetCenter should be -camPos (last call, after constructor)
    const calls = mat.setVector3.mock.calls.filter((c: any[]) => c[0] === 'planetCenter');
    const last = calls[calls.length - 1];
    expect(last).toBeDefined();
    const val = last[1];
    expect(val.x).toBe(-150);
    expect(val.y).toBe(-6375);
    expect(val.z).toBe(200);
    atmo.dispose();
  });

  it('update with camera at origin still computes correct planetCenter', () => {
    const atmo = new Atmosphere(defaultConfig, mockScene);
    const sunDir = new Vector3(0.5, 0.5, 0).normalize();
    const camPos = new Vector3(0, 0, 0);
    atmo.update(camPos, sunDir);
    const mat = (atmo.getMesh().material as any);
    const calls = mat.setVector3.mock.calls.filter((c: any[]) => c[0] === 'planetCenter');
    const last = calls[calls.length - 1];
    expect(last).toBeDefined();
    const val = last[1];
    expect(val.x).toBeCloseTo(0);
    expect(val.y).toBeCloseTo(0);
    expect(val.z).toBeCloseTo(0);
    atmo.dispose();
  });

  it('update preserves mesh position', () => {
    const atmo = new Atmosphere(defaultConfig, mockScene);
    const posSetSpy = (atmo.getMesh().position as any).set;
    atmo.update(new Vector3(100, 6373, 0), new Vector3(1, 0, 0));
    expect(posSetSpy).toHaveBeenCalledWith(0, 0, 0);
    atmo.dispose();
  });

  it('dispose does not throw', () => {
    const atmo = new Atmosphere(defaultConfig, mockScene);
    expect(() => atmo.dispose()).not.toThrow();
    expect(() => atmo.dispose()).not.toThrow();
  });
});
