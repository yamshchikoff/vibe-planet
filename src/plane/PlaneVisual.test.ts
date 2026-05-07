import { describe, it, expect, vi } from 'vitest';
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import { PlaneVisual } from './PlaneVisual';

let uniqueId = 0;
const mockScene = { getUniqueId: () => ++uniqueId, addTransformNode: vi.fn() };

vi.mock('@babylonjs/core/Meshes/meshBuilder', () => ({
  MeshBuilder: {
    CreateBox: vi.fn(() => ({
      position: { set: vi.fn(), x: 0, y: 0, z: 0 },
      material: null,
      receiveShadows: false,
      parent: null,
      dispose: vi.fn(),
    })),
  },
}));

vi.mock('@babylonjs/core/Materials/PBR/pbrMaterial', () => ({
  PBRMaterial: vi.fn().mockImplementation(function () {
    return { albedoColor: {}, metallic: 0, roughness: 0, dispose: vi.fn() };
  }),
}));

describe('PlaneVisual', () => {
  it('constructor does not throw', () => {
    const pv = new PlaneVisual(mockScene as any);
    expect(pv).toBeDefined();
    pv.dispose();
  });

  it('update changes group position', () => {
    const pv = new PlaneVisual(mockScene as any);
    pv.update([10, 20, 30], new Quaternion());
    expect(pv.getMesh().position.x).toBe(10);
    expect(pv.getMesh().position.y).toBe(20);
    expect(pv.getMesh().position.z).toBe(30);
    pv.dispose();
  });

  it('update stores rotation quaternion', () => {
    const pv = new PlaneVisual(mockScene as any);
    const q = new Quaternion(0.707, 0, 0.707, 0);
    pv.update([0, 0, 0], q);
    expect(pv.getMesh().rotationQuaternion).toBe(q);
    expect(pv.getMesh().rotationQuaternion!.x).toBe(0.707);
    pv.dispose();
  });

  it('dispose does not throw', () => {
    const pv = new PlaneVisual(mockScene as any);
    pv.getMesh();
    expect(() => pv.dispose()).not.toThrow();
    expect(() => pv.dispose()).not.toThrow();
  });
});
