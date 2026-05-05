import { FlightModel } from '../flight/FlightModel';
import type { ControlInput } from '../flight/types';

export interface TestPattern {
  name: string;
  controls(t: number, state: ReturnType<FlightModel['getState']>): ControlInput;
}

const PATTERNS: TestPattern[] = [
  {
    name: 'MANUAL',
    controls: () => ({ pitch: 0, yaw: 0, roll: 0, throttle: 0 }),
  },
  {
    name: 'STRAIGHT',
    controls: () => ({ pitch: 0.05, yaw: 0, roll: 0, throttle: 0.5 }),
  },
  {
    name: 'TURN_LEFT',
    controls: () => ({ pitch: 0.05, yaw: 0, roll: 0.5, throttle: 0.5 }),
  },
  {
    name: 'TURN_RIGHT',
    controls: () => ({ pitch: 0.05, yaw: 0, roll: -0.5, throttle: 0.5 }),
  },
  {
    name: 'CLIMB',
    controls: () => ({ pitch: 0.8, yaw: 0, roll: 0, throttle: 1 }),
  },
  {
    name: 'DIVE',
    controls: () => ({ pitch: -0.5, yaw: 0, roll: 0, throttle: 0 }),
  },
  {
    name: 'YAW_LEFT',
    controls: () => ({ pitch: 0, yaw: -0.5, roll: 0, throttle: 0.5 }),
  },
  {
    name: 'YAW_RIGHT',
    controls: () => ({ pitch: 0, yaw: 0.5, roll: 0, throttle: 0.5 }),
  },
];

export class FlightDebug {
  private flight: FlightModel;
  private hud: HTMLElement;
  private patternIdx = 0;
  private frameCount = 0;

  constructor(flight: FlightModel) {
    this.flight = flight;
    this.hud = document.getElementById('hud')!;
  }

  getControls(): ControlInput {
    return PATTERNS[this.patternIdx].controls(this.frameCount, this.flight.getState());
  }

  update(): void {
    this.frameCount++;
    const s = this.flight.getState();
    const [px, py, pz] = s.position;
    const altitude = Math.sqrt(px * px + py * py + pz * pz) - 6371;
    const radial = Math.sqrt(px * px + py * py + pz * pz);
    const [vx, vy, vz] = s.velocity;
    const fwd = [vx / s.speed, vy / s.speed, vz / s.speed]
      .map((v) => v.toFixed(4))
      .join(', ');

    this.hud.textContent =
      `[${PATTERNS[this.patternIdx].name}]  frame ${this.frameCount}\n` +
      `spd ${s.speed.toFixed(3)} km/s  max ${this.flight.getCruiseSpeed().toFixed(3)} km/s  thr ${(s.throttle * 100).toFixed(0)}%\n` +
      `alt ${altitude.toFixed(2)} km  rad ${radial.toFixed(1)} km\n` +
      `yaw ${(s.orientation.yaw * 180 / Math.PI).toFixed(1)}°  ` +
      `pit ${(s.orientation.pitch * 180 / Math.PI).toFixed(1)}°  ` +
      `rol ${(s.orientation.roll * 180 / Math.PI).toFixed(1)}°\n` +
      `pos ${px.toFixed(2)}, ${py.toFixed(2)}, ${pz.toFixed(2)}\n` +
      `fwd ${fwd}`;
  }

  nextPattern(): void {
    this.patternIdx = (this.patternIdx + 1) % PATTERNS.length;
    this.frameCount = 0;
  }

  getPatternName(): string {
    return PATTERNS[this.patternIdx].name;
  }
}
