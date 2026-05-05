import {
  SphereGeometry,
  ShaderMaterial,
  Mesh,
  BackSide,
  Vector3,
  Color,
} from 'three';

const vertexShader = `
varying vec3 vWorldPosition;
varying vec3 vNormal;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
uniform vec3 sunDirection;
uniform vec3 planetCenter;
uniform float planetRadius;
uniform float atmosphereHeight;
uniform vec3 atmosphereColor;

varying vec3 vWorldPosition;
varying vec3 vNormal;

void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  vec3 normal = normalize(vNormal);

  // Altitude above planet surface
  float distFromCenter = length(vWorldPosition - planetCenter);
  float altitude = max(0.0, distFromCenter - planetRadius);

  // Atmosphere density falls off exponentially with altitude
  float density = exp(-altitude / (atmosphereHeight * 0.25));

  // Angle between view and normal (limb glow — thicker at edges)
  float rim = 1.0 - max(0.0, dot(viewDir, normal));
  rim = pow(rim, 3.0);

  // Angle between sun and normal (sun-facing side brighter)
  float sunAngle = max(0.0, dot(normal, normalize(sunDirection)));

  // Optical depth
  float depth = rim * 0.8 + 0.2;

  // Combine color
  vec3 color = atmosphereColor * depth * density * (sunAngle * 1.2 + 0.2);

  // Fade to transparent at the top of the atmosphere
  float fade = 1.0 - smoothstep(0.0, atmosphereHeight, altitude);

  gl_FragColor = vec4(color, fade * 0.5);
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
        atmosphereColor: { value: new Color(0x66aaff) },
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
    // Planet center at render time = -camera.position (floating origin shift)
    this.material.uniforms.planetCenter.value.copy(cameraPos).negate();
    this.mesh.position.set(0, 0, 0);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
