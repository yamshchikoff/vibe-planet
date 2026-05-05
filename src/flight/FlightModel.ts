import { Quaternion, Vector3, Euler } from 'three';
import type { FlightState, ControlInput } from './types';

const SPEED_STEPS = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64]; // km/s — логарифмическая шкала
const SPEED_CRUISE = 2.0;    // km/s — крейсерская скорость по умолчанию
const THROTTLE_RATE = 4.0;   // 0 → 1 за ~0.25 с
const ROLL_RATE = 1.5;       // rad/s
const PITCH_RATE = 0.8;      // rad/s
const YAW_RATE = 1.0;        // rad/s
const START_ALTITUDE = 2;

export class FlightModel {
  private state: FlightState;
  private quat: Quaternion;
  private planetRadius: number;
  private spawnPosition: [number, number, number];
  private throttleInput: -1 | 0 | 1;
  private cruiseSpeed: number;
  // Pre-allocated temporaries
  private _dq = new Quaternion();
  private _euler = new Euler();
  private _forward = new Vector3();
  private _axis = new Vector3();

  constructor(planetRadius = 6371, spawnPosition?: [number, number, number]) {
    this.planetRadius = planetRadius;
    this.spawnPosition = spawnPosition ?? [0, planetRadius + START_ALTITUDE, 0];
    this.quat = new Quaternion();
    this.cruiseSpeed = SPEED_CRUISE;
    this.throttleInput = 0;
    this.state = this.initialState();
    this.alignToSurface();
  }

  private initialState(): FlightState {
    return {
      position: [...this.spawnPosition],
      velocity: [0, 0, 0],
      orientation: { yaw: 0, pitch: 0, roll: 0 },
      throttle: 0,
      speed: 0,
    };
  }

  getState(): FlightState {
    this._euler.setFromQuaternion(this.quat, 'XYZ');
    return {
      position: [...this.state.position],
      velocity: [...this.state.velocity],
      orientation: {
        yaw: this._euler.y || 0,
        pitch: this._euler.x || 0,
        roll: this._euler.z || 0,
      },
      throttle: this.state.throttle,
      speed: this.state.speed,
    };
  }

  applyControls(input: ControlInput): void {
    const dt = 1 / 60;
    this.throttleInput = Math.sign(input.throttle) as -1 | 0 | 1;

    if (input.pitch === 0 && input.yaw === 0 && input.roll === 0) return;

    // Yaw around world Y (left-multiply) — поворот платформы
    if (input.yaw !== 0) {
      this._axis.set(0, 1, 0);
      this._dq.setFromAxisAngle(this._axis, input.yaw * YAW_RATE * dt);
      this.quat.premultiply(this._dq);
    }
    // Roll вокруг локальной Z
    if (input.roll !== 0) {
      this._axis.set(0, 0, 1);
      this._dq.setFromAxisAngle(this._axis, input.roll * ROLL_RATE * dt);
      this.quat.multiply(this._dq);
    }
    // Pitch вокруг локальной X
    if (input.pitch !== 0) {
      this._axis.set(1, 0, 0);
      this._dq.setFromAxisAngle(this._axis, input.pitch * PITCH_RATE * dt);
      this.quat.multiply(this._dq);
    }

    this.quat.normalize();
  }

  update(dt: number): void {
    // Плавный газ: throttleInput (-1/0/1) → state.throttle
    const diff = this.throttleInput - this.state.throttle;
    if (Math.abs(diff) > 0.001) {
      this.state.throttle += Math.sign(diff) * Math.min(Math.abs(diff), THROTTLE_RATE * dt);
    } else {
      this.state.throttle = this.throttleInput;
    }

    const speed = this.state.throttle * this.cruiseSpeed;

    // Forward direction from orientation
    this._forward.set(0, 0, -1).applyQuaternion(this.quat);

    let [x, y, z] = this.state.position;
    let newX = x + this._forward.x * speed * dt;
    let newZ = z + this._forward.z * speed * dt;
    let newY = y + this._forward.y * speed * dt;

    // Ground collision — радиальное расстояние от центра планеты
    const dist = Math.sqrt(newX * newX + newY * newY + newZ * newZ);
    if (dist < this.planetRadius) {
      const scale = this.planetRadius / dist;
      newX *= scale;
      newY *= scale;
      newZ *= scale;
    }

    this.state.speed = Math.abs(speed);
    this.state.position = [newX, newY, newZ];
    this.state.velocity = [
      this._forward.x * speed,
      this._forward.y * speed,
      this._forward.z * speed,
    ];
  }

  /** Выровнять по поверхности: local Y → radial */
  private alignToSurface(): void {
    const [x, y, z] = this.spawnPosition;
    const radial = new Vector3(x, y, z).normalize();
    this.quat.setFromUnitVectors(new Vector3(0, 1, 0), radial);
  }

  reset(): void {
    this.quat.identity();
    this.throttleInput = 0;
    this.state = this.initialState();
    this.alignToSurface();
  }

  setSpawn(position: [number, number, number]): void {
    this.spawnPosition = position;
  }

  getCruiseSpeed(): number {
    return this.cruiseSpeed;
  }

  /** Change cruise speed along logarithmic scale (×2 or ÷2 per step) */
  changeSpeed(direction: -1 | 0 | 1): void {
    const idx = SPEED_STEPS.indexOf(this.cruiseSpeed);
    if (idx === -1) {
      // If current speed is not in the list (shouldn't happen), snap to nearest
      this.cruiseSpeed = SPEED_STEPS[Math.round(Math.log2(this.cruiseSpeed) + 3)];
      return;
    }
    const newIdx = Math.max(0, Math.min(SPEED_STEPS.length - 1, idx + direction));
    this.cruiseSpeed = SPEED_STEPS[newIdx];
  }
}
