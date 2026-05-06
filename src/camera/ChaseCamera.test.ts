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
});
