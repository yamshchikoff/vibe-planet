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
  private _lookDir = new Vector3();
  private _rollQuat = new Quaternion();

  constructor(cam: FreeCamera, config?: Partial<CameraConfig>) {
    this.cam = cam;
    this.config = { ...DEFAULTS, ...config };
    this.currentPos = new Vector3();
    if (!this.cam.rotationQuaternion) {
      this.cam.rotationQuaternion = new Quaternion();
    }
  }

  update(targetWorldPos: Vector3, targetQuat: Quaternion, dt: number, lookAtOffset?: Vector3): void {
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

    // Look target — optionally offset from targetWorldPos (e.g. look below plane)
    const lookTarget = this._lookDir.copyFrom(targetWorldPos);
    if (lookAtOffset) lookTarget.addInPlace(lookAtOffset);

    // Look at the target (plane)
    Vector3.NormalizeToRef(
      lookTarget.subtractInPlace(this.cam.position),
      this._lookDir
    );

    // Quaternion that rotates camera local -Z axis to lookDir
    Quaternion.FromUnitVectorsToRef(new Vector3(0, 0, -1), this._lookDir, this.cam.rotationQuaternion!);

    if (this.config.rollCouple) {
      // Extract roll angle from targetQuat (Babylon.js YXZ Euler: roll = Z axis)
      const roll = Math.atan2(
        2 * (targetQuat.w * targetQuat.z + targetQuat.x * targetQuat.y),
        1 - 2 * (targetQuat.y * targetQuat.y + targetQuat.z * targetQuat.z)
      );
      if (Math.abs(roll) > 0.001) {
        // Rotate camera around lookDir by the roll angle
        Quaternion.RotationAxisToRef(this._lookDir, roll, this._rollQuat);
        this._rollQuat.multiplyToRef(this.cam.rotationQuaternion!, this.cam.rotationQuaternion!);
        this.cam.rotationQuaternion!.normalize();
      }
    }
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
