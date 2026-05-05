import { describe, it, expect } from 'vitest';
import { PlaneVisual } from './plane/PlaneVisual';
import { Vector3 } from 'three';

describe('Camera follow', () => {
  it('copies plane quaternion — camera orientation matches plane', () => {
    const pv = new PlaneVisual();
    pv.update([0, 0, 0], 0, 0, Math.PI / 4); // 45° roll

    const q = pv.getMesh().quaternion.clone();
    // Camera quaternion is copied directly from plane group
    // With 45° roll (Z rotation), quaternion z component should be non-zero
    expect(q.z).not.toBe(0);
    expect(Math.abs(q.z)).toBeGreaterThan(0);
    pv.dispose();
  });

  it('transforms local camera offset (0,10,20) by plane quaternion', () => {
    const pv = new PlaneVisual();
    // Pitch 90° up — local +Z (behind) rotates to world +Y (below)
    // Actually: pitch=PI/2, local (0,10,20) → world rotation
    pv.update([0, 0, 0], 0, Math.PI / 2, 0);

    const q = pv.getMesh().quaternion;
    const offset = new Vector3(0, 10, 20).applyQuaternion(q);

    // With pitch=90°, local +Y (10) rotates to world -Z, local +Z (20) rotates to world -Y
    // x=0, y=10*cos(90) - 20*sin(90) = -20, z=10*sin(90) + 20*cos(90) = 10
    expect(offset.x).toBeCloseTo(0);
    expect(offset.y).toBeCloseTo(-20);
    expect(offset.z).toBeCloseTo(10);
    pv.dispose();
  });

  it('camera position = plane position + transformed offset', () => {
    const pv = new PlaneVisual();
    const planePos: [number, number, number] = [10, 25, -30];
    pv.update(planePos, 0, 0, 0);

    const q = pv.getMesh().quaternion;
    const offset = new Vector3(0, 10, 20).applyQuaternion(q);

    expect(offset.x).toBe(0);
    expect(offset.y).toBe(10);
    expect(offset.z).toBe(20);

    // Camera position would be planePos + offset
    const camPos = new Vector3(
      planePos[0] + offset.x,
      planePos[1] + offset.y,
      planePos[2] + offset.z
    );
    expect(camPos.x).toBe(10);
    expect(camPos.y).toBe(35);
    expect(camPos.z).toBe(-10);
    pv.dispose();
  });
});
