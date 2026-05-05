import { describe, it, expect } from 'vitest';
import { Atmosphere } from './Atmosphere';
import { Mesh, BackSide, ShaderMaterial, Vector3, SphereGeometry } from 'three';

describe('Atmosphere', () => {
  const defaultConfig = { planetRadius: 6371, atmosphereHeight: 80 };

  it('creates with config', () => {
    const atmo = new Atmosphere(defaultConfig);
    expect(atmo).toBeDefined();
    atmo.dispose();
  });

  it('getMesh returns a Mesh', () => {
    const atmo = new Atmosphere(defaultConfig);
    expect(atmo.getMesh()).toBeInstanceOf(Mesh);
    atmo.dispose();
  });

  it('mesh uses BackSide rendering', () => {
    const atmo = new Atmosphere(defaultConfig);
    expect(atmo.getMesh().material.side).toBe(BackSide);
    atmo.dispose();
  });

  it('mesh is transparent', () => {
    const atmo = new Atmosphere(defaultConfig);
    expect(atmo.getMesh().material.transparent).toBe(true);
    atmo.dispose();
  });

  it('mesh does not write to depth buffer', () => {
    const atmo = new Atmosphere(defaultConfig);
    expect(atmo.getMesh().material.depthWrite).toBe(false);
    atmo.dispose();
  });

  it('mesh has renderOrder 1', () => {
    const atmo = new Atmosphere(defaultConfig);
    expect(atmo.getMesh().renderOrder).toBe(1);
    atmo.dispose();
  });

  it('mesh uses ShaderMaterial', () => {
    const atmo = new Atmosphere(defaultConfig);
    expect(atmo.getMesh().material).toBeInstanceOf(ShaderMaterial);
    atmo.dispose();
  });

  it('mesh geometry is SphereGeometry', () => {
    const atmo = new Atmosphere(defaultConfig);
    expect(atmo.getMesh().geometry).toBeInstanceOf(SphereGeometry);
    atmo.dispose();
  });

  it('sphere radius is planetRadius + atmosphereHeight / 2', () => {
    const atmo = new Atmosphere(defaultConfig);
    const geo = atmo.getMesh().geometry as SphereGeometry;
    const parameters = (geo as any).parameters as Record<string, number>;
    if (parameters && typeof parameters.radius === 'number') {
      expect(parameters.radius).toBe(6371 + 40);
    }
    // Fallback: bounding sphere radius should be approximately R + H/2
    geo.computeBoundingSphere();
    const bsRadius = geo.boundingSphere?.radius ?? 0;
    expect(bsRadius).toBeGreaterThan(6000);
    expect(bsRadius).toBeLessThan(7000);
    atmo.dispose();
  });

  it('mesh is visible by default', () => {
    const atmo = new Atmosphere(defaultConfig);
    expect(atmo.getMesh().visible).toBe(true);
    atmo.dispose();
  });

  it('update sets sunDirection uniform', () => {
    const atmo = new Atmosphere(defaultConfig);
    const sunDir = new Vector3(0.5, 0.7, 0.3).normalize();
    const camPos = new Vector3(0, 6373, 0);
    atmo.update(camPos, sunDir);
    const uniform = (atmo.getMesh().material as ShaderMaterial).uniforms.sunDirection.value;
    expect(uniform.x).toBeCloseTo(sunDir.x, 5);
    expect(uniform.y).toBeCloseTo(sunDir.y, 5);
    expect(uniform.z).toBeCloseTo(sunDir.z, 5);
    atmo.dispose();
  });

  it('update sets planetCenter uniform to negated camera position', () => {
    const atmo = new Atmosphere(defaultConfig);
    const sunDir = new Vector3(1, 0, 0);
    const camPos = new Vector3(150, 6375, -200);
    atmo.update(camPos, sunDir);
    const uniform = (atmo.getMesh().material as ShaderMaterial).uniforms.planetCenter.value;
    expect(uniform.x).toBe(-150);
    expect(uniform.y).toBe(-6375);
    expect(uniform.z).toBe(200);
    atmo.dispose();
  });

  it('update with camera at origin still computes correct planetCenter', () => {
    const atmo = new Atmosphere(defaultConfig);
    const sunDir = new Vector3(0.5, 0.5, 0).normalize();
    const camPos = new Vector3(0, 0, 0);
    atmo.update(camPos, sunDir);
    const uniform = (atmo.getMesh().material as ShaderMaterial).uniforms.planetCenter.value;
    expect(uniform.x).toBeCloseTo(0);
    expect(uniform.y).toBeCloseTo(0);
    expect(uniform.z).toBeCloseTo(0);
    atmo.dispose();
  });

  it('update preserves mesh position', () => {
    const atmo = new Atmosphere(defaultConfig);
    const origPos = atmo.getMesh().position.clone();
    atmo.update(new Vector3(100, 6373, 0), new Vector3(1, 0, 0));
    expect(atmo.getMesh().position.x).toBe(origPos.x);
    expect(atmo.getMesh().position.y).toBe(origPos.y);
    expect(atmo.getMesh().position.z).toBe(origPos.z);
    atmo.dispose();
  });

  it('dispose does not throw', () => {
    const atmo = new Atmosphere(defaultConfig);
    expect(() => atmo.dispose()).not.toThrow();
    expect(() => atmo.dispose()).not.toThrow(); // double dispose
  });
});
