import { describe, it, expect, vi } from 'vitest';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';

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

import { PlaneVisual } from './plane/PlaneVisual';

describe('Camera follow', () => {
  it('copies plane quaternion — camera orientation matches plane', () => {
    const pv = new PlaneVisual(mockScene as any);
    pv.update([0, 0, 0], 0, 0, Math.PI / 4); // 45° roll

    const q = Quaternion.FromEulerAngles(0, 0, Math.PI / 4);
    expect(q.z).not.toBe(0);
    expect(Math.abs(q.z)).toBeGreaterThan(0);
    pv.dispose();
  });

  it('transforms local camera offset (0,10,20) by plane quaternion', () => {
    // Pitch 90° up — local +Z (behind) rotates to world +Y (below)
    const q = Quaternion.FromEulerAngles(Math.PI / 2, 0, 0);
    const offset = new Vector3(0, 10, 20);
    offset.applyRotationQuaternionToRef(q, offset);

    // With pitch=90°, local +Y (10) rotates to world -Z, local +Z (20) rotates to world -Y
    expect(offset.x).toBeCloseTo(0);
    expect(offset.y).toBeCloseTo(-20);
    expect(offset.z).toBeCloseTo(10);
  });

  it('camera position = plane position + transformed offset', () => {
    const planePos: [number, number, number] = [10, 25, -30];
    const q = Quaternion.FromEulerAngles(0, 0, 0);
    const offset = new Vector3(0, 10, 20);
    offset.applyRotationQuaternionToRef(q, offset);

    expect(offset.x).toBe(0);
    expect(offset.y).toBe(10);
    expect(offset.z).toBe(20);

    const camPos = new Vector3(
      planePos[0] + offset.x,
      planePos[1] + offset.y,
      planePos[2] + offset.z
    );
    expect(camPos.x).toBe(10);
    expect(camPos.y).toBe(35);
    expect(camPos.z).toBe(-10);
  });
});
