import { describe, it, expect, beforeEach } from 'vitest';
import { FlightModel } from './FlightModel';
import { PlaneVisual } from '../plane/PlaneVisual';
import { Vector3 } from 'three';

describe('FlightModel', () => {
  let flight: FlightModel;

  beforeEach(() => {
    flight = new FlightModel();
  });

  describe('initial state', () => {
    it('starts above ground with forward speed', () => {
      const state = flight.getState();
      expect(state.position[1]).toBeGreaterThan(6371); // above planet radius
      expect(state.speed).toBeGreaterThan(0);
    });

    it('has neutral orientation', () => {
      const state = flight.getState();
      expect(state.orientation.pitch).toBe(0);
      expect(state.orientation.yaw).toBe(0);
      expect(state.orientation.roll).toBe(0);
    });

    it('starts with zero throttle', () => {
      expect(flight.getState().throttle).toBe(0);
    });

    it('starts at north pole (z = 0), flying toward equator', () => {
      const state = flight.getState();
      expect(state.position[2]).toBe(0);
    });
  });

  describe('throttle', () => {
    it('increases throttle with positive input', () => {
      flight.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 1 });
      flight.update(1 / 60);
      expect(flight.getState().throttle).toBeGreaterThan(0);
    });

    it('never exceeds max throttle', () => {
      for (let i = 0; i < 100; i++) {
        flight.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 1 });
        flight.update(1 / 60);
      }
      expect(flight.getState().throttle).toBeLessThanOrEqual(1);
    });

    it('never goes below zero throttle', () => {
      flight.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: -1 });
      flight.update(1 / 60);
      expect(flight.getState().throttle).toBeGreaterThanOrEqual(0);
    });
  });

  describe('movement', () => {
    it('accelerates forward with throttle', () => {
      const initialSpeed = flight.getState().speed;
      for (let i = 0; i < 10; i++) {
        flight.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 1 });
        flight.update(1 / 60);
      }
      const state = flight.getState();
      expect(state.speed).toBeGreaterThan(initialSpeed);
    });

    it('changes pitch over time with pitch input', () => {
      flight.applyControls({ pitch: 1, yaw: 0, roll: 0, throttle: 0 });
      flight.update(1 / 60);
      expect(flight.getState().orientation.pitch).toBeGreaterThan(0);
    });

    it('banked pitch causes horizontal turn (body-axis control)', () => {
      // Roll 90° so local X (pitch axis) aligns with world Z
      for (let i = 0; i < 50; i++) {
        flight.applyControls({ pitch: 0, yaw: 0, roll: 1, throttle: 0 });
        flight.update(1 / 60);
      }
      expect(flight.getState().orientation.roll).toBeGreaterThan(Math.PI / 2 - 0.1);

      // Record X position after roll
      const px0 = flight.getState().position[0];

      // Pitch up while banked — body-axis pitch turns in horizontal plane
      for (let i = 0; i < 60; i++) {
        flight.applyControls({ pitch: 1, yaw: 0, roll: 0, throttle: 0.5 });
        flight.update(1 / 60);
      }

      const dx = Math.abs(flight.getState().position[0] - px0);

      // With body-axis controls, banking redirects pitch into world XZ
      // With old world-axis controls, pitch only affects Y → dx ≈ 0
      expect(dx).toBeGreaterThan(0.5);
    });
  });

  describe('ground collision', () => {
    it('does not go below ground level (y < planetRadius)', () => {
      flight.applyControls({ pitch: -1, yaw: 0, roll: 0, throttle: 0 });
      // Let it fall for a while (nose down + no throttle)
      for (let i = 0; i < 300; i++) {
        flight.applyControls({ pitch: -1, yaw: 0, roll: 0, throttle: 0 });
        flight.update(1 / 60);
      }
      const state = flight.getState();
      expect(state.position[1]).toBeGreaterThanOrEqual(6371); // planet radius
    });
  });

  describe('consistency with PlaneVisual', () => {
    it('nose direction matches movement direction after physics step', () => {
      const fm = new FlightModel(10);
      const pv = new PlaneVisual();

      // Apply some controls and step physics
      fm.applyControls({ pitch: 0.3, yaw: 0.5, roll: 0, throttle: 0.5 });
      fm.update(1 / 60);

      const state = fm.getState();
      const { yaw, pitch, roll } = state.orientation;
      const [vx, vy, vz] = state.velocity;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);

      // Update visual with same state
      pv.update(state.position, yaw, pitch, roll);

      // Nose direction from PlaneVisual group quaternion
      const noseDir = new Vector3(0, 0, -1).applyQuaternion(pv.getMesh().quaternion);

      // Movement direction from flight model velocity
      const moveDir = new Vector3(vx / speed, vy / speed, vz / speed);

      // Nose should point in the same direction as movement (dot > 0.99)
      const dot = noseDir.dot(moveDir);
      expect(dot).toBeGreaterThan(0.99);

      pv.dispose();
    });

    it('nose and movement stay aligned with non-zero roll', () => {
      const fm = new FlightModel(10);
      const pv = new PlaneVisual();

      // Steady turn with roll
      for (let i = 0; i < 30; i++) {
        fm.applyControls({ pitch: 0.1, yaw: 0.8, roll: 0.5, throttle: 0.5 });
        fm.update(1 / 60);
      }

      const state = fm.getState();
      const { yaw, pitch, roll } = state.orientation;
      const [vx, vy, vz] = state.velocity;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);

      pv.update(state.position, yaw, pitch, roll);

      const noseDir = new Vector3(0, 0, -1).applyQuaternion(pv.getMesh().quaternion);
      const moveDir = new Vector3(vx / speed, vy / speed, vz / speed);

      // Roll should not desync nose from movement: both come from same quaternion
      const dot = noseDir.dot(moveDir);
      expect(dot).toBeGreaterThan(0.5);

      pv.dispose();
    });

    it('initial state: nose in -Z, movement in -Z', () => {
      const fm = new FlightModel(10);
      const pv = new PlaneVisual();

      const state = fm.getState();
      const { yaw, pitch, roll } = state.orientation;

      pv.update(state.position, yaw, pitch, roll);

      const noseDir = new Vector3(0, 0, -1).applyQuaternion(pv.getMesh().quaternion);
      const [vx, vy, vz] = state.velocity;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const moveDir = new Vector3(vx / speed, vy / speed, vz / speed);

      // Both should point in -Z
      expect(noseDir.z).toBeLessThan(0);
      expect(moveDir.z).toBeLessThan(0);

      // And both should roughly be (0, 0, -1)
      expect(noseDir.x).toBeCloseTo(0);
      expect(noseDir.y).toBeCloseTo(0);
      expect(noseDir.z).toBeCloseTo(-1);

      expect(moveDir.x).toBeCloseTo(0);
      expect(moveDir.y).toBeCloseTo(0);
      expect(moveDir.z).toBeCloseTo(-1);

      pv.dispose();
    });

    it('velocity magnitude equals speed', () => {
      const fm = new FlightModel(10);

      for (let i = 0; i < 10; i++) {
        fm.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 0.5 });
        fm.update(1 / 60);
      }

      const state = fm.getState();
      const [vx, vy, vz] = state.velocity;
      const vMag = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const speed = state.speed;

      // Slight tolerance for vertical speed component
      expect(vMag).toBeCloseTo(speed, 1);
    });
  });

  describe('state reset', () => {
    it('resets to initial state', () => {
      for (let i = 0; i < 30; i++) {
        flight.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 1 });
        flight.update(1 / 60);
      }
      const preSpeed = flight.getState().speed;

      flight.reset();
      const state = flight.getState();
      // After reset should be different from pre-reset
      expect(state.speed).not.toBe(preSpeed);
      expect(state.throttle).toBe(0);
    });
  });
});
