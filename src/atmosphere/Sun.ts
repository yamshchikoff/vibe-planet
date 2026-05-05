import {
  DirectionalLight,
  Vector3,
  HemisphereLight,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  AdditiveBlending,
  Color,
} from 'three';

export interface SunConfig {
  inclination: number;
  longitude: number;
}

export class Sun {
  private light: DirectionalLight;
  private hemi: HemisphereLight;
  private sunSprite: Sprite | null = null;
  private direction: Vector3;
  private inclination: number;
  private time = 0;

  constructor(config?: Partial<SunConfig>) {
    this.inclination = config?.inclination ?? 0.41; // ~23.5° axial tilt
    this.light = new DirectionalLight(0xfff5e6, 1.5);
    this.light.position.set(50000, 30000, 0);
    this.hemi = new HemisphereLight(0x87CEEB, 0x3B2F2F, 0.3);
    this.direction = new Vector3();
  }

  private createSunSprite(): Sprite {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, 'rgba(255, 255, 230, 1)');
      gradient.addColorStop(0.08, 'rgba(255, 240, 180, 1)');
      gradient.addColorStop(0.25, 'rgba(255, 200, 80, 0.9)');
      gradient.addColorStop(0.5, 'rgba(255, 150, 30, 0.4)');
      gradient.addColorStop(0.75, 'rgba(255, 100, 0, 0.1)');
      gradient.addColorStop(1, 'rgba(255, 60, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }

    const texture = new CanvasTexture(canvas);
    const material = new SpriteMaterial({
      map: texture,
      blending: AdditiveBlending,
      depthTest: false,
      transparent: true,
    });

    const sprite = new Sprite(material);
    sprite.scale.set(12000, 12000, 1);
    return sprite;
  }

  getLight(): DirectionalLight {
    return this.light;
  }

  getHemisphere(): HemisphereLight {
    return this.hemi;
  }

  getSunSprite(): Sprite {
    if (!this.sunSprite) {
      this.sunSprite = this.createSunSprite();
    }
    return this.sunSprite;
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

    // Hemisphere light: dynamic sky/ground colors and intensity
    const noonIntensity = 0.40;
    const nightIntensity = 0.12;
    const dayFactor = Math.max(0, height);
    this.hemi.intensity = nightIntensity + (noonIntensity - nightIntensity) * dayFactor;

    // Sky: cool blue at noon → warm orange at sunset → dark grey at night
    const skyColor = new Color(0x87CEEB)
      .lerp(new Color(0xFF8844), Math.max(0, -height * 2))
      .lerp(new Color(0x111122), 1 - dayFactor);
    this.hemi.color.copy(skyColor);

    // Ground: dark brown at noon → darker at night
    const groundColor = new Color(0x3B2F2F)
      .lerp(new Color(0x1a1a2e), 1 - dayFactor);
    this.hemi.groundColor.copy(groundColor);

    // Sun sprite position
    if (this.sunSprite) {
      this.sunSprite.position.copy(this.direction).multiplyScalar(500000);
    }
  }

  dispose(): void {
    if (this.sunSprite) {
      this.sunSprite.material.map?.dispose();
      this.sunSprite.material.dispose();
    }
  }
}
