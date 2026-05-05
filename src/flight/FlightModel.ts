import { FlightState, ControlInput } from './types';

const GRAVITY = 9.8;
const MAX_THRUST = 15;
const DRAG_COEFF = 0.02;
const LIFT_COEFF = 0.08;
const THROTTLE_RATE = 2.0;
const ROTATION_RATE = 2.0;
const MIN_FLIGHT_SPEED = 2.0;
const START_ALTITUDE = 15;

export class FlightModel {
  private state: FlightState;
  private planetRadius: number;

  constructor(planetRadius = 10) {
    this.planetRadius = planetRadius;
    this.state = this.initialState();
  }

  private initialState(): FlightState {
    return {
      position: [0, this.planetRadius + START_ALTITUDE, -this.planetRadius * 2],
      velocity: [0, 0, -8],
      orientation: { yaw: 0, pitch: 0, roll: 0 },
      throttle: 0,
      speed: 8,
    };
  }

  getState(): FlightState {
    return { ...this.state, orientation: { ...this.state.orientation } };
  }

  applyControls(input: ControlInput): void {
    // Throttle change rate per call (assumed once per frame at ~60fps)
    const dt = 1 / 60;
    this.state.throttle = Math.max(
      0,
      Math.min(1, this.state.throttle + input.throttle * THROTTLE_RATE * dt)
    );

    this.state.orientation.pitch += input.pitch * ROTATION_RATE * dt;
    this.state.orientation.yaw += input.yaw * ROTATION_RATE * dt;
    this.state.orientation.roll += input.roll * ROTATION_RATE * dt;
    this.state.orientation.pitch = Math.max(
      -Math.PI / 2,
      Math.min(Math.PI / 2, this.state.orientation.pitch)
    );
  }

  update(dt: number): void {
    const { throttle, orientation, speed } = this.state;
    const { pitch } = orientation;

    // Forces
    const thrust = throttle * MAX_THRUST;
    const drag = DRAG_COEFF * speed * speed;
    const lift = LIFT_COEFF * speed * speed * Math.cos(pitch);
    const gravAlong = GRAVITY * Math.sin(pitch);
    const gravVert = GRAVITY * Math.cos(pitch);

    const accFwd = thrust - drag - gravAlong;
    const accUp = lift - gravVert;

    let newSpeed = speed + accFwd * dt;
    let verticalSpeed = 0 + accUp * dt;

    if (newSpeed < 0) newSpeed = 0;

    const [x, y, z] = this.state.position;

    const cosYaw = Math.cos(orientation.yaw);
    const sinYaw = Math.sin(orientation.yaw);
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);

    const fwdX = -sinYaw * cosPitch;
    const fwdZ = -cosYaw * cosPitch;
    const fwdY = sinPitch;

    const newX = x + fwdX * newSpeed * dt;
    const newZ = z + fwdZ * newSpeed * dt;
    let newY = y + fwdY * newSpeed * dt + verticalSpeed * dt;

    // Ground collision: clamp position, kill only downward velocity
    if (newY < this.planetRadius) {
      newY = this.planetRadius;
      verticalSpeed = 0;
    }

    this.state.speed = newSpeed;
    this.state.position = [newX, newY, newZ];
    this.state.velocity = [
      fwdX * newSpeed,
      fwdY * newSpeed + verticalSpeed,
      fwdZ * newSpeed,
    ];
  }

  reset(): void {
    this.state = this.initialState();
  }
}
