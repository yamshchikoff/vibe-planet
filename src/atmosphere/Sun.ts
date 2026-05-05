import {
  DirectionalLight,
  Vector3,
  Color,
  AmbientLight,
} from 'three';

export interface SunConfig {
  inclination: number;
  longitude: number;
}

export class Sun {
  private light: DirectionalLight;
  private ambient: AmbientLight;
  private direction: Vector3;
  private inclination: number;
  private time = 0;

  constructor(config?: Partial<SunConfig>) {
    this.inclination = config?.inclination ?? 0.41; // ~23.5° axial tilt
    this.light = new DirectionalLight(0xfff5e6, 1.5);
    this.light.position.set(50000, 30000, 0);
    this.ambient = new AmbientLight(0x223355, 0.15);
    this.direction = new Vector3();
  }

  getLight(): DirectionalLight {
    return this.light;
  }

  getAmbient(): AmbientLight {
    return this.ambient;
  }

  getDirection(): Vector3 {
    return this.direction;
  }

  update(dt: number): void {
    // Full rotation every 120 seconds of game time
    this.time += dt * 0.05; // slow orbit

    const angle = this.time;
    const tilt = this.inclination;

    const sx = Math.sin(angle) * Math.cos(tilt);
    const sy = Math.sin(tilt);
    const sz = Math.cos(angle) * Math.cos(tilt);

    this.direction.set(sx, sy, sz).normalize();
    this.light.position.copy(this.direction).multiplyScalar(100000);

    // Dim at night
    const height = sy;
    const intensity = 0.3 + 0.7 * Math.max(0, height);
    this.light.intensity = 1.5 * intensity;
    this.ambient.intensity = 0.05 + 0.15 * Math.max(0, height);
  }

  dispose(): void {
    // Light doesn't need disposal
  }
}
