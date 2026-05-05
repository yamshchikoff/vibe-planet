import { describe, it, expect, beforeEach } from 'vitest';
import { FlightModel } from './FlightModel';

describe('FlightModel', () => {
  let flight: FlightModel;

  beforeEach(() => {
    flight = new FlightModel();
  });

  describe('initial state', () => {
    it('starts above ground with forward speed', () => {
      const state = flight.getState();
      expect(state.position[1]).toBeGreaterThan(10); // above planet radius
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
      expect(state.position[1]).toBeGreaterThanOrEqual(10); // planet radius
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
