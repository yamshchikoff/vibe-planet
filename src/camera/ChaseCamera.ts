import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

export interface CameraConfig {
  offset: [number, number, number];
  lerpSpeed: number;
  rollCouple: boolean;
}

const DEFAULTS: CameraConfig = {
  offset: [0, 0.006, 0.015],
  lerpSpeed: 0.3,
  rollCouple: true,
};

export class ChaseCamera {
  private cam: FreeCamera;
  private config: CameraConfig;
  private currentPos: Vector3;
  private firstFrame = true;
  private _desired = new Vector3();
  private _offsetVec = new Vector3();
  private _camOffset: Quaternion;
  lookDir = new Vector3();

  constructor(cam: FreeCamera, config?: Partial<CameraConfig>) {
    this.cam = cam;
    this.config = { ...DEFAULTS, ...config };
    this.currentPos = new Vector3();

    // Precompute camera-to-body offset quaternion.
    // FreeCamera default: +Z forward, +Y up (Babylon.js LH).
    // Body frame: +X forward, +Z up, +Y right.
    // This offset rotates camera axes to body axes:
    //   camera +Z → body +X  (forward)
    //   camera +Y → body +Z  (up)
    // Step 1: rotate (0,0,1) to (1,0,0) — 90° around +Y
    const q1 = Quaternion.RotationAxis(new Vector3(0, 1, 0), Math.PI / 2);
    // Step 2: rotate (0,1,0) to (0,0,1) — 90° around +X
    const q2 = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI / 2);
    this._camOffset = q2.multiply(q1);
  }

  update(targetWorldPos: Vector3, targetQuat: Quaternion, dt: number): void {
    this._offsetVec.set(this.config.offset[0], this.config.offset[1], this.config.offset[2]);
    this._offsetVec.applyRotationQuaternionToRef(targetQuat, this._offsetVec);
    this._desired.copyFrom(targetWorldPos).addInPlace(this._offsetVec);

    if (this.firstFrame) {
      this.currentPos.copyFrom(this._desired);
      this.firstFrame = false;
    } else {
      const lerpFactor = Math.min(this.config.lerpSpeed, this.config.lerpSpeed / (dt * 60));
      Vector3.LerpToRef(this.currentPos, this._desired, lerpFactor * dt * 60, this.currentPos);
    }

    this.cam.position.copyFrom(this.currentPos);

    // Camera fully inherits plane orientation.
    // Camera -Z → body +X (forward), camera +Y → body +Z (up)
    this.cam.rotationQuaternion = targetQuat.multiply(this._camOffset);

    // Camera looks forward along the aircraft's longitudinal axis (body +X)
    this.lookDir.set(1, 0, 0);
    this.lookDir.applyRotationQuaternionToRef(targetQuat, this.lookDir);
  }

  setCamera(cam: FreeCamera): void {
    this.cam = cam;
  }

  setOffset(offset: [number, number, number]): void {
    this.config.offset = offset;
  }

  setLerpSpeed(speed: number): void {
    this.config.lerpSpeed = speed;
  }

  reset(): void {
    this.firstFrame = true;
  }
}
