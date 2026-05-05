import { describe, it, expect, beforeEach } from 'vitest';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { ChaseCamera } from './ChaseCamera';

describe('ChaseCamera', () => {
  let cam: PerspectiveCamera;
  let chase: ChaseCamera;

  beforeEach(() => {
    cam = new PerspectiveCamera(75, 16 / 9, 0.001, 200000);
    chase = new ChaseCamera(cam);
  });

  describe('initial state', () => {
    it('places camera at the first frame target (no lerp delay)', () => {
      const pos = new Vector3(100, 200, 300);
      const q = new Quaternion();
      chase.update(pos, q, 1 / 60);

      // First frame: camera jumps to offset position
      expect(cam.position.distanceTo(pos)).toBeGreaterThan(0);
    });

    it('uses default offset [0, 0.006, 0.015]', () => {
      // At origin with identity quaternion => camera at (0, 0.006, 0.015)
      const pos = new Vector3(0, 6373, 0);
      const q = new Quaternion();
      q.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(0, 1, 0));

      chase.update(pos, q, 1 / 60);
      expect(cam.position.x).toBeCloseTo(0);
      expect(cam.position.y).toBeCloseTo(6373 + 0.006);
      expect(cam.position.z).toBeCloseTo(0.015);
    });
  });

  describe('smooth follow', () => {
    it('lerps toward target over multiple frames', () => {
      // First frame at pos1 — camera jumps to exact offset
      const pos1 = new Vector3(0, 6373, 0);
      const q = new Quaternion();
      chase.update(pos1, q, 1 / 60);
      const exact1 = new Vector3(0, 6373.006, 0.015);

      // Camera should be at exact1 after first frame
      expect(cam.position.distanceTo(exact1)).toBeLessThan(0.001);

      // Move target to pos2 — camera should lerp from pos1 toward pos2 offset
      const pos2 = new Vector3(1, 6374, 0);
      chase.update(pos2, q, 1 / 60);
      const exact2 = new Vector3(1, 6374.006, 0.015);

      // Camera moved away from exact1 toward exact2
      expect(cam.position.distanceTo(exact1)).toBeGreaterThan(0.001);
      expect(cam.position.distanceTo(exact2)).toBeGreaterThan(0.001);

      // After multiple frames, camera reaches exact2
      for (let i = 0; i < 30; i++) {
        chase.update(pos2, q, 1 / 60);
      }
      expect(cam.position.distanceTo(exact2)).toBeLessThan(0.001);
    });

    it('looks at the target position', () => {
      const pos = new Vector3(0, 6373, 0);
      const q = new Quaternion();

      // Run several frames to stabilize
      for (let i = 0; i < 10; i++) {
        chase.update(pos, q, 1 / 60);
      }

      // Camera should be looking toward the target
      const lookDir = new Vector3();
      cam.getWorldDirection(lookDir);
      const toTarget = new Vector3().copy(pos).sub(cam.position).normalize();
      expect(lookDir.dot(toTarget)).toBeGreaterThan(0.99);
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

      // Move target far away
      const pos2 = new Vector3(500, 600, 700);
      chase.update(pos2, q, 1 / 60);
      const distBeforeReset = cam.position.distanceTo(pos2);

      // Reset and update
      chase.reset();
      chase.update(pos2, q, 1 / 60);
      const distAfterReset = cam.position.distanceTo(pos2);

      expect(distAfterReset).toBeLessThan(distBeforeReset);
    });
  });
});
