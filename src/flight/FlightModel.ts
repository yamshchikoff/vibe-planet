import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { FlightState, ControlInput } from './types';

const SPEED_STEPS = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64];
const SPEED_CRUISE = 2.0;
const THROTTLE_RATE = 4.0;
const ROLL_RATE = 1.5;
const PITCH_RATE = 0.8;
const YAW_RATE = 1.0;
const START_ALTITUDE = 2;

export class FlightModel {
  private state: FlightState;
  private quat: Quaternion;
  private planetRadius: number;
  private spawnPosition: [number, number, number];
  private throttleInput: -1 | 0 | 1;
  private cruiseSpeed: number;
  private _dq = new Quaternion();
  private _qRot = new Quaternion();
  private _eulerOut = new Vector3();
  private _axis = new Vector3();
  private _fwdBase = new Vector3(0, 0, -1);

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
    this.quat.toEulerAnglesToRef(this._eulerOut);
    return {
      position: [...this.state.position],
      velocity: [...this.state.velocity],
      orientation: {
        yaw: this._eulerOut.y || 0,
        pitch: this._eulerOut.x || 0,
        roll: this._eulerOut.z || 0,
      },
      throttle: this.state.throttle,
      speed: this.state.speed,
    };
  }

  applyControls(input: ControlInput): void {
    const dt = 1 / 60;
    this.throttleInput = Math.sign(input.throttle) as -1 | 0 | 1;

    if (input.pitch === 0 && input.yaw === 0 && input.roll === 0) return;

    // Yaw around world Y (left-multiply)
    if (input.yaw !== 0) {
      this._axis.set(0, 1, 0);
      Quaternion.RotationAxisToRef(this._axis, input.yaw * YAW_RATE * dt, this._qRot);
      this._qRot.multiplyToRef(this.quat, this._dq);
      this.quat.copyFrom(this._dq);
    }
    // Roll around local Z (right-multiply)
    if (input.roll !== 0) {
      this._axis.set(0, 0, 1);
      Quaternion.RotationAxisToRef(this._axis, input.roll * ROLL_RATE * dt, this._qRot);
      this.quat.multiplyToRef(this._qRot, this._dq);
      this.quat.copyFrom(this._dq);
    }
    // Pitch around local X (right-multiply)
    if (input.pitch !== 0) {
      this._axis.set(1, 0, 0);
      Quaternion.RotationAxisToRef(this._axis, input.pitch * PITCH_RATE * dt, this._qRot);
      this.quat.multiplyToRef(this._qRot, this._dq);
      this.quat.copyFrom(this._dq);
    }

    this.quat.normalize();
  }

  update(dt: number): void {
    const diff = this.throttleInput - this.state.throttle;
    if (Math.abs(diff) > 0.001) {
      this.state.throttle += Math.sign(diff) * Math.min(Math.abs(diff), THROTTLE_RATE * dt);
    } else {
      this.state.throttle = this.throttleInput;
    }

    const speed = this.state.throttle * this.cruiseSpeed;

    // Forward direction from orientation
    const fwd = this._fwdBase.applyRotationQuaternion(this.quat);

    let [x, y, z] = this.state.position;
    let newX = x + fwd.x * speed * dt;
    let newZ = z + fwd.z * speed * dt;
    let newY = y + fwd.y * speed * dt;

    // Ground collision — radial distance from planet center
    const dist = Math.sqrt(newX * newX + newY * newY + newZ * newZ);
    if (dist < this.planetRadius) {
      const scale = this.planetRadius / dist;
      newX *= scale;
      newY *= scale;
      newZ *= scale;
    }

    this.state.speed = Math.abs(speed);
    this.state.position = [newX, newY, newZ];
    this.state.velocity = [fwd.x * speed, fwd.y * speed, fwd.z * speed];
  }

  /** Align to surface: local Y → radial */
  private alignToSurface(): void {
    const [x, y, z] = this.spawnPosition;
    const radial = new Vector3(x, y, z).normalize();
    Quaternion.FromUnitVectorsToRef(new Vector3(0, 1, 0), radial, this.quat);
  }

  reset(): void {
    this.quat.copyFrom(Quaternion.Identity());
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

  changeSpeed(direction: -1 | 0 | 1): void {
    const idx = SPEED_STEPS.indexOf(this.cruiseSpeed);
    if (idx === -1) {
      this.cruiseSpeed = SPEED_STEPS[Math.round(Math.log2(this.cruiseSpeed) + 3)];
      return;
    }
    const newIdx = Math.max(0, Math.min(SPEED_STEPS.length - 1, idx + direction));
    this.cruiseSpeed = SPEED_STEPS[newIdx];
  }
}
