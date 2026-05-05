import { Quaternion, Vector3, Euler } from 'three';
import type { FlightState, ControlInput } from './types';

const GRAVITY = 0.0098;
const MAX_THRUST = 10.0;
const DRAG_COEFF = 0.02;
const LIFT_COEFF = 0.00008;
const THROTTLE_RATE = 2.0;
const ROLL_RATE = 2.0;
const PITCH_RATE = 2.0;
const YAW_RATE = 0.5;
const COORD_TURN_RATE = 0.6;
const START_ALTITUDE = 2;

export class FlightModel {
  private state: FlightState;
  private planetRadius: number;
  private quat: Quaternion;
  // Pre-allocated temporaries
  private _dq = new Quaternion();
  private _euler = new Euler();
  private _forward = new Vector3();
  private _localUp = new Vector3();
  private _axis = new Vector3();

  constructor(planetRadius = 6371) {
    this.planetRadius = planetRadius;
    this.quat = new Quaternion();
    this.state = this.initialState();
  }

  private initialState(): FlightState {
    return {
      position: [0, this.planetRadius + START_ALTITUDE, 0],
      velocity: [0, 0, -8],
      orientation: { yaw: 0, pitch: 0, roll: 0 },
      throttle: 0,
      speed: 8,
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
    this.state.throttle = Math.max(
      0,
      Math.min(1, this.state.throttle + input.throttle * THROTTLE_RATE * dt)
    );

    if (input.pitch === 0 && input.yaw === 0 && input.roll === 0) return;

    // Yaw around world Y (left-multiply) — gentle rudder, no roll coupling
    if (input.yaw !== 0) {
      this._axis.set(0, 1, 0);
      this._dq.setFromAxisAngle(this._axis, input.yaw * YAW_RATE * dt);
      this.quat.premultiply(this._dq);
    }
    // Roll in local body frame (ailerons)
    if (input.roll !== 0) {
      this._axis.set(0, 0, 1);
      this._dq.setFromAxisAngle(this._axis, input.roll * ROLL_RATE * dt);
      this.quat.multiply(this._dq);
    }
    // Pitch in local body frame (elevator)
    if (input.pitch !== 0) {
      this._axis.set(1, 0, 0);
      this._dq.setFromAxisAngle(this._axis, input.pitch * PITCH_RATE * dt);
      this.quat.multiply(this._dq);
    }

    // Clamp pitch to avoid gimbal lock
    this._euler.setFromQuaternion(this.quat, 'XYZ');
    const clampedPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this._euler.x));
    if (clampedPitch !== this._euler.x) {
      this._euler.x = clampedPitch;
      this.quat.setFromEuler(this._euler);
    }

    this.quat.normalize();
  }

  update(dt: number): void {
    const throttle = this.state.throttle;
    let speed = this.state.speed;

    // Coordinated turn: bank angle produces smooth heading change
    this._euler.setFromQuaternion(this.quat, 'XYZ');
    const bank = this._euler.z;
    if (Math.abs(bank) > 0.02) {
      const turnRate = COORD_TURN_RATE * Math.sin(bank);
      this._axis.set(0, 1, 0);
      this._dq.setFromAxisAngle(this._axis, turnRate * dt);
      this.quat.premultiply(this._dq);
      this.quat.normalize();
    }

    // Forward and up vectors in world space from orientation quaternion
    this._forward.set(0, 0, -1).applyQuaternion(this.quat);
    this._localUp.set(0, 1, 0).applyQuaternion(this.quat);

    // Forces
    const thrust = throttle * MAX_THRUST;
    const drag = DRAG_COEFF * speed * speed;
    const liftMag = LIFT_COEFF * speed * speed;

    // Gravity along forward direction (slows down when climbing)
    const gravAlongFwd = GRAVITY * this._forward.y;
    // Net vertical acceleration (world Y): lift projection minus gravity
    const accVert = liftMag * this._localUp.y - GRAVITY;

    const accFwd = thrust - drag - gravAlongFwd;

    speed += accFwd * dt;
    if (speed < 0) speed = 0;

    const [x, y, z] = this.state.position;
    const newX = x + this._forward.x * speed * dt;
    const newZ = z + this._forward.z * speed * dt;
    let newY = y + this._forward.y * speed * dt + accVert * dt;

    // Ground collision
    if (newY < this.planetRadius) {
      newY = this.planetRadius;
    }

    this.state.speed = speed;
    this.state.position = [newX, newY, newZ];
    this.state.velocity = [
      this._forward.x * speed,
      this._forward.y * speed + accVert,
      this._forward.z * speed,
    ];
  }

  reset(): void {
    this.quat.identity();
    this.state = this.initialState();
  }
}
