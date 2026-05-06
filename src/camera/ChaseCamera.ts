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
  private _camOffset = new Quaternion();
  private _tmpQuat = new Quaternion();

  constructor(cam: FreeCamera, config?: Partial<CameraConfig>) {
    this.cam = cam;
    this.config = { ...DEFAULTS, ...config };
    this.currentPos = new Vector3();
    if (!this.cam.rotationQuaternion) {
      this.cam.rotationQuaternion = new Quaternion();
    }
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

    if (this.config.rollCouple) {
      this._lookDir.set(
        -this.config.offset[0],
        -this.config.offset[1],
        -this.config.offset[2],
      ).normalize();
      Quaternion.FromUnitVectorsToRef(new Vector3(0, 0, -1), this._lookDir, this._camOffset);
      targetQuat.multiplyToRef(this._camOffset, this._tmpQuat);
      this.cam.rotationQuaternion!.copyFrom(this._tmpQuat);
    } else {
      this.cam.setTarget(targetWorldPos);
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
