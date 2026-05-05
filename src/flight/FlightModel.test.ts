import { describe, it, expect, beforeEach } from 'vitest';
import { FlightModel } from './FlightModel';
import { PlaneVisual } from '../plane/PlaneVisual';
import { Vector3, Euler, Quaternion } from 'three';

const SPEED_CRUISE = 2.0;

describe('FlightModel', () => {
  let flight: FlightModel;

  beforeEach(() => {
    flight = new FlightModel();
  });

  describe('initial state', () => {
    it('is above planet surface', () => {
      const state = flight.getState();
      const [px, py, pz] = state.position;
      const dist = Math.sqrt(px * px + py * py + pz * pz);
      expect(dist).toBeGreaterThan(6371);
    });

    it('has zero speed and throttle', () => {
      const state = flight.getState();
      expect(state.speed).toBe(0);
      expect(state.throttle).toBe(0);
    });

    it('has neutral orientation at north pole', () => {
      const state = flight.getState();
      expect(state.orientation.pitch).toBe(0);
      expect(state.orientation.yaw).toBe(0);
      expect(state.orientation.roll).toBe(0);
    });
  });

  describe('throttle', () => {
    it('ramps up with Shift (throttle=1)', () => {
      flight.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 1 });
      flight.update(1 / 60);
      expect(flight.getState().throttle).toBeGreaterThan(0);
    });

    it('ramps down with Ctrl (throttle=-1)', () => {
      flight.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: -1 });
      flight.update(1 / 60);
      expect(flight.getState().throttle).toBeLessThan(0);
    });

    it('stays within [-1, 1]', () => {
      for (let i = 0; i < 200; i++) {
        flight.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 1 });
        flight.update(1 / 60);
      }
      expect(flight.getState().throttle).toBeLessThanOrEqual(1);
      expect(flight.getState().throttle).toBeGreaterThanOrEqual(0);
    });

    it('ramps to 0 when no throttle input', () => {
      flight.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 1 });
      for (let i = 0; i < 30; i++) {
        flight.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 1 });
        flight.update(1 / 60);
      }
      expect(flight.getState().throttle).toBeGreaterThan(0.5);

      // Release throttle
      for (let i = 0; i < 30; i++) {
        flight.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 0 });
        flight.update(1 / 60);
      }
      expect(flight.getState().throttle).toBeLessThan(0.1);
    });

    it('speed equals |throttle| * SPEED_CRUISE', () => {
      flight.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 1 });
      for (let i = 0; i < 30; i++) {
        flight.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 1 });
        flight.update(1 / 60);
      }
      const s = flight.getState();
      expect(s.speed).toBeCloseTo(Math.abs(s.throttle) * SPEED_CRUISE, 5);
    });
  });

  describe('movement', () => {
    it('moves forward with positive throttle', () => {
      // Start at north pole: position (0, 6373, 0), identity quaternion
      const [x0, y0, z0] = flight.getState().position;
      for (let i = 0; i < 30; i++) {
        flight.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 1 });
        flight.update(1 / 60);
      }
      const [x1, y1, z1] = flight.getState().position;
      const moved = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2);
      expect(moved).toBeGreaterThan(0);
      // Forward is -Z: should move in -Z direction
      expect(z1).toBeLessThan(z0);
    });

    it('moves backward with negative throttle', () => {
      const [x0, y0, z0] = flight.getState().position;
      for (let i = 0; i < 30; i++) {
        flight.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: -1 });
        flight.update(1 / 60);
      }
      const [x1, y1, z1] = flight.getState().position;
      // Forward is -Z, backward is +Z
      expect(z1).toBeGreaterThan(z0);
    });

    it('does not move with zero throttle', () => {
      const [x0, y0, z0] = flight.getState().position;
      for (let i = 0; i < 60; i++) {
        flight.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 0 });
        flight.update(1 / 60);
      }
      const [x1, y1, z1] = flight.getState().position;
      expect(x1).toBe(x0);
      expect(y1).toBe(y0);
      expect(z1).toBe(z0);
    });
  });

  describe('orientation', () => {
    it('pitch changes with pitch input', () => {
      flight.applyControls({ pitch: 1, yaw: 0, roll: 0, throttle: 0 });
      flight.update(1 / 60);
      expect(flight.getState().orientation.pitch).toBeGreaterThan(0);
    });

    it('roll changes with roll input', () => {
      flight.applyControls({ pitch: 0, yaw: 0, roll: 1, throttle: 0 });
      flight.update(1 / 60);
      expect(flight.getState().orientation.roll).toBeGreaterThan(0);
    });

    it('yaw changes with yaw input', () => {
      flight.applyControls({ pitch: 0, yaw: 1, roll: 0, throttle: 0 });
      flight.update(1 / 60);
      expect(flight.getState().orientation.yaw).toBeGreaterThan(0);
    });

    it('opposite yaw reverses direction', () => {
      flight.applyControls({ pitch: 0, yaw: 1, roll: 0, throttle: 0 });
      for (let i = 0; i < 30; i++) {
        flight.applyControls({ pitch: 0, yaw: 1, roll: 0, throttle: 0 });
        flight.update(1 / 60);
      }
      const yawPos = flight.getState().orientation.yaw;

      flight.applyControls({ pitch: 0, yaw: -1, roll: 0, throttle: 0 });
      for (let i = 0; i < 30; i++) {
        flight.applyControls({ pitch: 0, yaw: -1, roll: 0, throttle: 0 });
        flight.update(1 / 60);
      }
      const yawNeg = flight.getState().orientation.yaw;

      // Yaw left should be less than yaw right
      expect(yawNeg).toBeLessThan(yawPos);
    });
  });

  describe('non-polar spawn', () => {
    it('no spontaneous movement at mountain spawn', () => {
      const fm = new FlightModel(6371, [5993.87, 2181.71, 0]);
      const [x0, y0, z0] = fm.getState().position;
      for (let i = 0; i < 60; i++) {
        fm.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 0 });
        fm.update(1 / 60);
      }
      const [x1, y1, z1] = fm.getState().position;
      expect(x1).toBe(x0);
      expect(y1).toBe(y0);
      expect(z1).toBe(z0);
    });

    it('forward is tangent to surface at mountain spawn', () => {
      const fm = new FlightModel(6371, [5993.87, 2181.71, 0]);
      fm.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 1 });
      for (let i = 0; i < 30; i++) {
        fm.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 1 });
        fm.update(1 / 60);
      }
      const state = fm.getState();
      const [px, py, pz] = state.position;
      const radial = new Vector3(px, py, pz).normalize();
      const [vx, vy, vz] = state.velocity;
      const fwd = new Vector3(vx, vy, vz).normalize();

      // Нос направлен по касательной к поверхности
      expect(Math.abs(fwd.dot(radial))).toBeLessThan(0.05);
    });
  });

  describe('ground collision', () => {
    it('does not go below planet surface', () => {
      // Point nose down and apply throttle
      for (let i = 0; i < 60; i++) {
        flight.applyControls({ pitch: -1, yaw: 0, roll: 0, throttle: 0 });
        flight.update(1 / 60);
      }
      // Now fly down
      for (let i = 0; i < 200; i++) {
        flight.applyControls({ pitch: -1, yaw: 0, roll: 0, throttle: 1 });
        flight.update(1 / 60);
      }
      const state = flight.getState();
      const [px, py, pz] = state.position;
      const dist = Math.sqrt(px * px + py * py + pz * pz);
      expect(dist).toBeGreaterThanOrEqual(6371 - 0.001);
    });
  });

  describe('consistency with PlaneVisual', () => {
    it('nose direction matches movement direction', () => {
      const fm = new FlightModel(6371, [5993.87, 2181.71, 0]);
      const pv = new PlaneVisual();

      fm.applyControls({ pitch: 0.3, yaw: 0.5, roll: 0, throttle: 1 });
      for (let i = 0; i < 30; i++) {
        fm.applyControls({ pitch: 0.3, yaw: 0.5, roll: 0, throttle: 1 });
        fm.update(1 / 60);
      }

      const state = fm.getState();
      const { yaw, pitch, roll } = state.orientation;
      const [vx, vy, vz] = state.velocity;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);

      pv.update(state.position, yaw, pitch, roll);
      const noseDir = new Vector3(0, 0, -1).applyQuaternion(pv.getMesh().quaternion);
      const moveDir = new Vector3(vx / speed, vy / speed, vz / speed);

      expect(noseDir.dot(moveDir)).toBeGreaterThan(0.99);
      pv.dispose();
    });

    it('initial state: nose in -Z, movement in -Z at north pole', () => {
      const fm = new FlightModel(10);
      const pv = new PlaneVisual();

      fm.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 1 });
      fm.update(1 / 60);
      const state = fm.getState();
      const { yaw, pitch, roll } = state.orientation;
      pv.update(state.position, yaw, pitch, roll);

      const noseDir = new Vector3(0, 0, -1).applyQuaternion(pv.getMesh().quaternion);
      const [vx, vy, vz] = state.velocity;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const moveDir = new Vector3(vx / speed, vy / speed, vz / speed);

      expect(noseDir.z).toBeLessThan(0);
      expect(moveDir.z).toBeLessThan(0);
      expect(noseDir.x).toBeCloseTo(0);
      expect(noseDir.z).toBeCloseTo(-1);
      pv.dispose();
    });

    it('velocity magnitude equals speed', () => {
      const fm = new FlightModel(6371, [5993.87, 2181.71, 0]);

      for (let i = 0; i < 30; i++) {
        fm.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 1 });
        fm.update(1 / 60);
      }

      const state = fm.getState();
      const [vx, vy, vz] = state.velocity;
      const vMag = Math.sqrt(vx * vx + vy * vy + vz * vz);
      expect(vMag).toBeCloseTo(state.speed, 5);
    });
  });

  describe('state reset', () => {
    it('resets to initial state', () => {
      for (let i = 0; i < 60; i++) {
        flight.applyControls({ pitch: 1, yaw: 0, roll: 0, throttle: 1 });
        flight.update(1 / 60);
      }
      const preSpeed = flight.getState().speed;

      flight.reset();
      const state = flight.getState();
      expect(state.speed).toBe(0);
      expect(state.throttle).toBe(0);
      // Reset should change state from pre-reset
      expect(state.speed).not.toBe(preSpeed);
    });
  });

  describe('speed scale', () => {
    it('default cruise speed is 2.0', () => {
      expect(flight.getCruiseSpeed()).toBe(2.0);
    });

    it('changeSpeed(1) doubles cruise speed', () => {
      flight.changeSpeed(1);
      expect(flight.getCruiseSpeed()).toBeCloseTo(4.0);
      flight.changeSpeed(1);
      expect(flight.getCruiseSpeed()).toBeCloseTo(8.0);
    });

    it('changeSpeed(-1) halves cruise speed', () => {
      flight.changeSpeed(-1);
      expect(flight.getCruiseSpeed()).toBeCloseTo(1.0);
      flight.changeSpeed(-1);
      expect(flight.getCruiseSpeed()).toBeCloseTo(0.5);
    });

    it('moves faster at higher cruise speed', () => {
      const baseMove = (speed: number): number => {
        const fm = new FlightModel(6371, [6373, 0, 0]);
        fm.changeSpeed(speed === 4 ? 1 : -1);
        for (let i = 0; i < 30; i++) {
          fm.applyControls({ pitch: 0, yaw: 0, roll: 0, throttle: 1 });
          fm.update(1 / 60);
        }
        const [, , z] = fm.getState().position;
        return Math.abs(z);
      };
      expect(baseMove(4)).toBeGreaterThan(baseMove(1));
    });

    it('clamps at max scale (64 km/s)', () => {
      for (let i = 0; i < 10; i++) flight.changeSpeed(1);
      expect(flight.getCruiseSpeed()).toBeLessThanOrEqual(64);
      // Extra increments stay at max
      flight.changeSpeed(1);
      expect(flight.getCruiseSpeed()).toBeLessThanOrEqual(64);
    });

    it('clamps at min scale (0.125 km/s)', () => {
      for (let i = 0; i < 10; i++) flight.changeSpeed(-1);
      expect(flight.getCruiseSpeed()).toBeGreaterThanOrEqual(0.125);
      flight.changeSpeed(-1);
      expect(flight.getCruiseSpeed()).toBeGreaterThanOrEqual(0.125);
    });
  });
});
