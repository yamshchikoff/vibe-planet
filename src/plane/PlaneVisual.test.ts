import { describe, it, expect } from 'vitest';
import { PlaneVisual } from './PlaneVisual';
import { Mesh } from 'three';

describe('PlaneVisual', () => {
  it('creates a group with children', () => {
    const pv = new PlaneVisual();
    const mesh = pv.getMesh();
    expect(mesh.type).toBe('Group');
    expect(mesh.children.length).toBeGreaterThan(0);
    pv.dispose();
  });

  it('update changes group position', () => {
    const pv = new PlaneVisual();
    pv.update([10, 20, 30], 0, 0, 0);
    expect(pv.getMesh().position.x).toBe(10);
    expect(pv.getMesh().position.y).toBe(20);
    expect(pv.getMesh().position.z).toBe(30);
    pv.dispose();
  });

  it('update changes group rotation', () => {
    const pv = new PlaneVisual();
    pv.update([0, 0, 0], 1, 0.5, 0.3);
    expect(pv.getMesh().rotation.y).toBe(1);
    expect(pv.getMesh().rotation.x).toBe(0.5);
    expect(pv.getMesh().rotation.z).toBe(0.3);
    pv.dispose();
  });

  it('nose points in -Z direction (forward)', () => {
    const pv = new PlaneVisual();
    const minZ = Math.min(...pv.getMesh().children.map(c => c.position.z));
    expect(minZ).toBeLessThan(0);
    pv.dispose();
  });

  it('all sub-meshes have shadow enabled', () => {
    const pv = new PlaneVisual();
    for (const child of pv.getMesh().children) {
      const mesh = child as Mesh;
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
    }
    pv.dispose();
  });

  it('dispose does not throw', () => {
    const pv = new PlaneVisual();
    pv.getMesh();
    expect(() => pv.dispose()).not.toThrow();
    expect(() => pv.dispose()).not.toThrow(); // double dispose
  });
});
