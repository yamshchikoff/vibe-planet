import { describe, it, expect, vi } from 'vitest';
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
    pv.update([10, 20, 30], 0, 0, 0);
    expect(pv.getMesh().position.x).toBe(10);
    expect(pv.getMesh().position.y).toBe(20);
    expect(pv.getMesh().position.z).toBe(30);
    pv.dispose();
  });

  it('update changes group rotation', () => {
    const pv = new PlaneVisual(mockScene as any);
    pv.update([0, 0, 0], 1, 0.5, 0.3);
    expect(pv.getMesh().rotation.y).toBe(1);
    expect(pv.getMesh().rotation.x).toBe(0.5);
    expect(pv.getMesh().rotation.z).toBe(0.3);
    pv.dispose();
  });

  it('dispose does not throw', () => {
    const pv = new PlaneVisual(mockScene as any);
    pv.getMesh();
    expect(() => pv.dispose()).not.toThrow();
    expect(() => pv.dispose()).not.toThrow();
  });
});
