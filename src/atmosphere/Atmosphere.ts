import {
  SphereGeometry,
  ShaderMaterial,
  Mesh,
  BackSide,
  Vector3,
  Color,
} from 'three';

const vertexShader = `
varying vec3 vPosition;
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
uniform vec3 sunDirection;
uniform vec3 planetCenter;
uniform float planetRadius;
uniform float atmosphereHeight;
uniform vec3 atmosphereColor;

varying vec3 vPosition;
varying vec3 vNormal;

void main() {
  vec3 viewDir = normalize(-vPosition);
  vec3 normal = normalize(vNormal);

  // Angle between view and normal (limb glow)
  float rim = 1.0 - max(0.0, dot(viewDir, normal));
  rim = pow(rim, 3.0);

  // Angle between sun and normal (sun-facing side brighter)
  float sunAngle = max(0.0, dot(normal, normalize(sunDirection)));

  // Optical depth (more at edges)
  float depth = rim * 0.8 + 0.2;

  // Combine
  vec3 color = atmosphereColor * depth * (sunAngle * 0.8 + 0.2);

  // Fade at top and bottom
  float dist = length(vPosition);
  float fade = 1.0 - smoothstep(planetRadius * 0.98, planetRadius + atmosphereHeight, dist);

  gl_FragColor = vec4(color, fade * 0.6);
}
`;

export interface AtmosphereConfig {
  planetRadius: number;
  atmosphereHeight: number;
}

export class Atmosphere {
  private mesh: Mesh;
  private material: ShaderMaterial;

  constructor(config: AtmosphereConfig) {
    const R = config.planetRadius;
    const H = config.atmosphereHeight;

    const geo = new SphereGeometry(R + H * 0.5, 48, 32);
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        sunDirection: { value: new Vector3(1, 0.5, 0).normalize() },
        planetCenter: { value: new Vector3(0, 0, 0) },
        planetRadius: { value: R },
        atmosphereHeight: { value: H },
        atmosphereColor: { value: new Color(0x4488ff) },
      },
      side: BackSide,
      transparent: true,
      depthWrite: false,
    });

    this.mesh = new Mesh(geo, this.material);
    this.mesh.renderOrder = 1;
  }

  getMesh(): Mesh {
    return this.mesh;
  }

  update(cameraPos: Vector3, sunDir: Vector3): void {
    this.material.uniforms.sunDirection.value.copy(sunDir);
    // Position the atmosphere sphere at the planet center
    this.mesh.position.set(0, 0, 0);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
