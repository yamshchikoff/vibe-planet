import type { ControlInput } from '../flight/types';

const KEY_MAP: Record<string, keyof ControlInput> = {
  KeyW: 'pitch',
  KeyS: 'pitch',
  KeyA: 'roll',
  KeyD: 'roll',
  KeyQ: 'yaw',
  KeyE: 'yaw',
  ShiftLeft: 'throttle',
  ShiftRight: 'throttle',
  ControlLeft: 'throttle',
  ControlRight: 'throttle',
};

const KEY_SIGN: Record<string, number> = {
  KeyW: 1,
  KeyS: -1,
  KeyA: 1,
  KeyD: -1,
  KeyQ: -1,
  KeyE: 1,
  ShiftLeft: 1,
  ShiftRight: 1,
  ControlLeft: -1,
  ControlRight: -1,
};

export class KeyboardControls {
  private keys = new Set<string>();
  private attached = false;

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code in KEY_MAP) {
      this.keys.add(e.code);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
  };

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.keys.clear();
  }

  getInput(): ControlInput {
    let pitch = 0;
    let yaw = 0;
    let roll = 0;
    let throttle = 0;

    for (const code of this.keys) {
      const axis = KEY_MAP[code];
      const sign = KEY_SIGN[code];
      if (axis === 'pitch') pitch += sign;
      else if (axis === 'yaw') yaw += sign;
      else if (axis === 'roll') roll += sign;
      else if (axis === 'throttle') throttle += sign;
    }

    return {
      pitch: Math.sign(pitch) as -1 | 0 | 1,
      yaw: Math.sign(yaw) as -1 | 0 | 1,
      roll: Math.sign(roll) as -1 | 0 | 1,
      throttle: Math.sign(throttle) as -1 | 0 | 1,
    };
  }
}
