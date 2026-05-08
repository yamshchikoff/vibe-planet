import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';

export interface SunConfig {
  inclination: number;
}

const SUN_DISTANCE = 100_000;
const SUN_ANGULAR_RADIUS = 0.265; // degrees (sun apparent radius from Earth)
const SUN_SPHERE_RADIUS = SUN_DISTANCE * Math.tan(SUN_ANGULAR_RADIUS * Math.PI / 180);
const LIGHT_POSITION_SCALE = 100_000;

export class Sun {
  private light: DirectionalLight;
  private sunSphere: Mesh | null = null;
  private direction: Vector3;

  constructor(scene: Scene, config?: Partial<SunConfig>) {
    const inclination = config?.inclination ?? 0.41; // ~23.5° axial tilt

    // Compute fixed sun direction (static, no orbital motion)
    this.direction = new Vector3(0, Math.sin(inclination), Math.cos(inclination));
    this.direction.normalize();

    // Directional light — only light source, creates sharp day/night terminator
    this.light = new DirectionalLight('sun', this.direction.scale(-1), scene);
    this.light.position.copyFrom(this.direction.scale(LIGHT_POSITION_SCALE));
    this.light.setDirectionToTarget(Vector3.Zero());
    this.light.intensity = 1.5;
    this.light.diffuse = new Color3(1, 0.96, 0.9); // warm white #fff5e6
  }

  private createSunSphere(scene: Scene): Mesh {
    const sphere = MeshBuilder.CreateSphere(
      'sunSphere',
      { diameter: SUN_SPHERE_RADIUS * 2, segments: 32 },
      scene
    );
    sphere.position.copyFrom(this.direction.scale(SUN_DISTANCE));

    const mat = new StandardMaterial('sunMat', scene);
    mat.emissiveColor = new Color3(1, 0.95, 0.7); // warm yellow
    mat.disableLighting = true;
    sphere.material = mat;

    return sphere;
  }

  getLight(): DirectionalLight {
    return this.light;
  }

  getSunSphere(scene?: Scene): Mesh {
    if (!this.sunSphere) {
      this.sunSphere = this.createSunSphere(scene!);
    }
    return this.sunSphere;
  }

  getDirection(): Vector3 {
    return this.direction;
  }

  /**
   * Currently no-op — sun is static. Will animate when day/night cycle
   * is re-enabled.
   */
  update(_dt: number): void {
    // Static sun — no orbital motion
  }

  dispose(): void {
    if (this.sunSphere) {
      this.sunSphere.dispose();
    }
    this.light.dispose();
  }
}
