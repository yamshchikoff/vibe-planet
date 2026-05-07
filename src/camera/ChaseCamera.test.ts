import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChaseCamera } from './ChaseCamera';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';

function createMockCamera() {
  return {
    position: new Vector3(0, 0, 0),
    rotationQuaternion: new Quaternion(),
    fov: 0,
    minZ: 0,
    maxZ: 0,
    lookAt: vi.fn(),
  };
}

/** Assert that two vectors are equal within tolerance */
function vecEq(a: Vector3, b: Vector3, tol = 0.001): void {
  expect(Vector3.Distance(a, b)).toBeLessThan(tol);
}

describe('ChaseCamera', () => {
  let cam: ReturnType<typeof createMockCamera>;
  let chase: ChaseCamera;

  beforeEach(() => {
    cam = createMockCamera();
    chase = new ChaseCamera(cam as any);
  });

  describe('initial state', () => {
    it('places camera at the first frame target (no lerp delay)', () => {
      const pos = new Vector3(100, 200, 300);
      const q = new Quaternion();
      chase.update(pos, q, 1 / 60);

      expect(cam.position.x).toBeGreaterThan(0);
      expect(cam.position.y).toBeGreaterThan(0);
    });

    it('uses default offset [0, 0.006, 0.015]', () => {
      const pos = new Vector3(0, 6373, 0);
      const q = new Quaternion();

      chase.update(pos, q, 1 / 60);
      expect(cam.position.x).toBeCloseTo(0);
      expect(cam.position.y).toBeCloseTo(6373 + 0.006);
      expect(cam.position.z).toBeCloseTo(0.015);
    });
  });

  describe('smooth follow', () => {
    it('lerps toward target over multiple frames', () => {
      const pos1 = new Vector3(0, 6373, 0);
      const q = new Quaternion();
      chase.update(pos1, q, 1 / 60);
      const exact1 = new Vector3(0, 6373.006, 0.015);

      expect(Vector3.Distance(cam.position, exact1)).toBeLessThan(0.001);

      const pos2 = new Vector3(1, 6374, 0);
      chase.update(pos2, q, 1 / 60);
      const exact2 = new Vector3(1, 6374.006, 0.015);

      expect(Vector3.Distance(cam.position, exact1)).toBeGreaterThan(0.001);
      expect(Vector3.Distance(cam.position, exact2)).toBeGreaterThan(0.001);

      for (let i = 0; i < 30; i++) {
        chase.update(pos2, q, 1 / 60);
      }
      expect(Vector3.Distance(cam.position, exact2)).toBeLessThan(0.001);
    });
  });

  describe('configuration', () => {
    it('accepts custom offset', () => {
      chase.setOffset([0, 0.01, 0.02]);
      const pos = new Vector3(0, 6373, 0);
      const q = new Quaternion();
      chase.update(pos, q, 1 / 60);

      expect(cam.position.y).toBeCloseTo(6373 + 0.01);
      expect(cam.position.z).toBeCloseTo(0.02);
    });

    it('reset jumps to target immediately', () => {
      const pos = new Vector3(50, 60, 70);
      const q = new Quaternion();
      chase.update(pos, q, 1 / 60);

      const pos2 = new Vector3(500, 600, 700);
      chase.update(pos2, q, 1 / 60);
      const distBeforeReset = Vector3.Distance(cam.position, pos2);

      chase.reset();
      chase.update(pos2, q, 1 / 60);
      const distAfterReset = Vector3.Distance(cam.position, pos2);

      expect(distAfterReset).toBeLessThan(distBeforeReset);
    });
  });

  describe('orientation inheritance', () => {
    it('camera forward (-Z) matches body forward (+X)', () => {
      const q = Quaternion.FromEulerAngles(Math.PI / 4, 0, 0);
      chase.update(new Vector3(0, 0, 0), q, 1 / 60);

      const camForward = new Vector3(0, 0, -1).applyRotationQuaternion(cam.rotationQuaternion);
      const bodyForward = new Vector3(1, 0, 0).applyRotationQuaternion(q);

      vecEq(camForward, bodyForward);
    });

    it('camera up (+Y) matches body up (+Z)', () => {
      const q = Quaternion.FromEulerAngles(0, Math.PI / 6, Math.PI / 3);
      chase.update(new Vector3(0, 0, 0), q, 1 / 60);

      const camUp = new Vector3(0, 1, 0).applyRotationQuaternion(cam.rotationQuaternion);
      const bodyUp = new Vector3(0, 0, 1).applyRotationQuaternion(q);

      vecEq(camUp, bodyUp);
    });

    it('camera right (+X) × camera up (+Y) = -camera forward (right-handed)', () => {
      // In a right-handed camera: X × Y = Z (behind), and -Z = forward
      const q = Quaternion.FromEulerAngles(0.2, 0.4, 0.6);
      chase.update(new Vector3(0, 0, 0), q, 1 / 60);

      const camRight = new Vector3(1, 0, 0).applyRotationQuaternion(cam.rotationQuaternion);
      const camUp = new Vector3(0, 1, 0).applyRotationQuaternion(cam.rotationQuaternion);
      const camForward = new Vector3(0, 0, -1).applyRotationQuaternion(cam.rotationQuaternion);

      const computedForward = Vector3.Cross(camRight, camUp).normalize();
      // X × Y should = Z = -forward (camera Z points behind)
      vecEq(computedForward, camForward.scale(-1));
    });

    it('works with pure roll (90°) — camera follows plane roll', () => {
      // 90° roll around body X
      const q = Quaternion.FromEulerAngles(Math.PI / 2, 0, 0);
      chase.update(new Vector3(0, 0, 0), q, 1 / 60);

      const camForward = new Vector3(0, 0, -1).applyRotationQuaternion(cam.rotationQuaternion);
      const bodyForward = new Vector3(1, 0, 0).applyRotationQuaternion(q);

      vecEq(camForward, bodyForward);
    });

    it('camQuat structure: camQuat = targetQuat * _camOffset', () => {
      // The camera quaternion should equal targetQuat composed with the fixed offset
      const q = Quaternion.FromEulerAngles(0.3, 0.5, 0.7);
      const q1 = Quaternion.RotationAxis(new Vector3(0, -1, 0), Math.PI / 2);
      const q2 = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI / 2);
      const camOffset = q2.multiply(q1);
      const expected = q.multiply(camOffset);

      chase.update(new Vector3(0, 0, 0), q, 1 / 60);

      expect(cam.rotationQuaternion.w).toBeCloseTo(expected.w);
      expect(cam.rotationQuaternion.x).toBeCloseTo(expected.x);
      expect(cam.rotationQuaternion.y).toBeCloseTo(expected.y);
      expect(cam.rotationQuaternion.z).toBeCloseTo(expected.z);
    });
  });
});
