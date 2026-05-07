import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { Scene } from '@babylonjs/core/scene';

export interface SunConfig {
  inclination: number;
  longitude: number;
}

export class Sun {
  private light: DirectionalLight;
  private hemi: HemisphericLight;
  private sunDisc: Mesh | null = null;
  private direction: Vector3;
  private inclination: number;
  private time = 0;
  private _tmpColor = new Color3();

  constructor(scene: Scene, config?: Partial<SunConfig>) {
    this.inclination = config?.inclination ?? 0.41; // ~23.5° axial tilt
    this.light = new DirectionalLight('sun', new Vector3(0, 1, 0), scene);
    this.light.intensity = 1.5;
    this.light.diffuse = new Color3(1, 0.96, 0.9); // warm white #fff5e6

    this.hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    this.hemi.diffuse = new Color3(0.53, 0.81, 0.92); // sky #87CEEB
    this.hemi.groundColor = new Color3(0.23, 0.18, 0.18); // ground #3B2F2F
    this.hemi.intensity = 0.3;

    this.direction = new Vector3();
  }

  private createSunDisc(scene: Scene): Mesh {
    const disc = MeshBuilder.CreatePlane('sunDisc', { size: 1 }, scene);
    disc.billboardMode = Mesh.BILLBOARDMODE_ALL;
    disc.scaling.set(12000, 12000, 1);

    const size = 256;
    const texture = new DynamicTexture('sunDisc', { width: size, height: size }, scene, false);
    texture.hasAlpha = true;

    const ctx = texture.getContext();
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255, 255, 230, 1)');
    gradient.addColorStop(0.08, 'rgba(255, 240, 180, 1)');
    gradient.addColorStop(0.25, 'rgba(255, 200, 80, 0.9)');
    gradient.addColorStop(0.5, 'rgba(255, 150, 30, 0.4)');
    gradient.addColorStop(0.75, 'rgba(255, 100, 0, 0.1)');
    gradient.addColorStop(1, 'rgba(255, 60, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    texture.update();

    const mat = new StandardMaterial('sunDiscMat', scene);
    mat.opacityTexture = texture;
    mat.emissiveTexture = texture;
    mat.diffuseTexture = texture;
    mat.disableLighting = true;
    disc.material = mat;

    disc.renderingGroupId = 2;
    return disc;
  }

  getLight(): DirectionalLight {
    return this.light;
  }

  getHemisphere(): HemisphericLight {
    return this.hemi;
  }

  getSunDisc(scene?: Scene): Mesh {
    if (!this.sunDisc) {
      this.sunDisc = this.createSunDisc(scene!);
    }
    return this.sunDisc;
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

    this.direction.set(sx, sy, sz);
    this.direction.normalize();

    this.light.position.copyFrom(this.direction.scale(100000));
    this.light.setDirectionToTarget(Vector3.Zero());

    // Dim at night
    const height = sy;
    const intensity = 0.3 + 0.7 * Math.max(0, height);
    this.light.intensity = 1.5 * intensity;

    // Hemisphere light: dynamic sky/ground colors and intensity
    const noonIntensity = 0.40;
    const nightIntensity = 0.12;
    const dayFactor = Math.max(0, height);
    this.hemi.intensity = nightIntensity + (noonIntensity - nightIntensity) * dayFactor;

    // Sky: cool blue at noon => warm orange at sunset => dark grey at night
    const t1 = Math.max(0, -height * 2);
    const t2 = 1 - dayFactor;
    Color3.LerpToRef(new Color3(0.53, 0.81, 0.92), new Color3(1, 0.53, 0.27), t1, this._tmpColor);
    Color3.LerpToRef(this._tmpColor, new Color3(0.07, 0.07, 0.13), t2, this._tmpColor);
    this.hemi.diffuse.copyFrom(this._tmpColor);

    // Ground: dark brown at noon => darker at night
    Color3.LerpToRef(new Color3(0.23, 0.18, 0.18), new Color3(0.10, 0.10, 0.18), t2, this._tmpColor);
    this.hemi.groundColor.copyFrom(this._tmpColor);

    // Sun disc position
    if (this.sunDisc) {
      this.sunDisc.position.copyFrom(this.direction.scale(500000));
    }
  }

  dispose(): void {
    if (this.sunDisc) {
      this.sunDisc.dispose();
    }
    this.light.dispose();
    this.hemi.dispose();
  }
}
