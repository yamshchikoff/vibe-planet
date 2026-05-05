import { PerspectiveCamera, Quaternion, Vector3 } from 'three';

export interface CameraConfig {
  offset: [number, number, number]; // local offset (Y=up, Z=behind), default [0, 0.006, 0.015]
  lerpSpeed: number;                // 0..1, smoothness, default 0.3
  rollCouple: boolean;              // камера вращается по крену с самолётом, default true
}

const DEFAULTS: CameraConfig = {
  offset: [0, 0.006, 0.015],
  lerpSpeed: 0.3,
  rollCouple: true,
};

export class ChaseCamera {
  private cam: PerspectiveCamera;
  private config: CameraConfig;
  private currentPos: Vector3;
  private firstFrame = true;
  // Pre-allocated temporaries
  private _desired = new Vector3();
  private _offsetVec = new Vector3();
  private _lookDir = new Vector3();
  private _camOffset = new Quaternion();

  constructor(cam: PerspectiveCamera, config?: Partial<CameraConfig>) {
    this.cam = cam;
    this.config = { ...DEFAULTS, ...config };
    this.currentPos = new Vector3();
  }

  update(targetWorldPos: Vector3, targetQuat: Quaternion, dt: number): void {
    // Compute desired camera position in world space
    this._offsetVec.set(this.config.offset[0], this.config.offset[1], this.config.offset[2]);
    this._offsetVec.applyQuaternion(targetQuat);
    this._desired.copy(targetWorldPos).add(this._offsetVec);

    if (this.firstFrame) {
      this.currentPos.copy(this._desired);
      this.firstFrame = false;
    } else {
      // Clamp lerp factor to avoid overshoot at low FPS
      const lerpFactor = Math.min(this.config.lerpSpeed, this.config.lerpSpeed / (dt * 60));
      this.currentPos.lerp(this._desired, lerpFactor * dt * 60);
    }

    this.cam.position.copy(this.currentPos);

    if (this.config.rollCouple) {
      // Камера вращается по крену вместе с самолётом.
      // В локальной системе самолёта: камера в offset, цель в (0,0,0).
      // Направление от камеры к цели в локальной системе:
      this._lookDir.set(
        -this.config.offset[0],
        -this.config.offset[1],
        -this.config.offset[2],
      ).normalize();
      // Поворот от дефолтного forward (-Z) к lookDir
      this._camOffset.setFromUnitVectors(new Vector3(0, 0, -1), this._lookDir);
      // Итоговая ориентация = самолёт × доворот на цель
      this.cam.quaternion.copy(targetQuat).multiply(this._camOffset);
    } else {
      this.cam.lookAt(targetWorldPos);
    }
  }

  setCamera(cam: PerspectiveCamera): void {
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
