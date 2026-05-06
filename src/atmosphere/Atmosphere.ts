import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';

const vertexShader = `
#include<meshUboDeclaration>
#include<sceneUboDeclaration>

attribute vec3 position;
attribute vec3 normal;

varying vec3 vWorldPosition;
varying vec3 vNormal;
void main() {
  vec4 worldPos = world * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  vNormal = normalize((world * vec4(normal, 0.0)).xyz);
  gl_Position = viewProjection * world * vec4(position, 1.0);
}
`;

const fragmentShader = `
uniform vec3 cameraPosition;

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

  float distFromCenter = length(vWorldPosition - planetCenter);
  float altitude = max(0.0, distFromCenter - planetRadius);

  float density = exp(-altitude / (atmosphereHeight * 0.25));

  float rim = 1.0 - max(0.0, dot(viewDir, normal));
  rim = pow(rim, 3.0);

  float sunAngle = max(0.0, dot(normal, normalize(sunDirection)));

  float depth = rim * 0.8 + 0.2;

  vec3 color = atmosphereColor * depth * density * (sunAngle * 1.2 + 0.2);

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
  private _tmpVec = new Vector3();

  constructor(config: AtmosphereConfig, scene: Scene) {
    const R = config.planetRadius;
    const H = config.atmosphereHeight;

    this.mesh = MeshBuilder.CreateSphere('atmoSphere', { diameter: (R + H * 0.5) * 2, segments: 48 }, scene);

    this.material = new ShaderMaterial(
      'atmo',
      scene,
      { vertexSource: vertexShader, fragmentSource: fragmentShader },
      {
        attributes: ['position', 'normal'],
        uniforms: ['world', 'view', 'projection', 'viewProjection', 'cameraPosition', 'sunDirection', 'planetCenter', 'planetRadius', 'atmosphereHeight', 'atmosphereColor'],
        needAlphaBlending: true,
      }
    );

    this.material.backFaceCulling = true;
    this.material.sideOrientation = Material.ClockWiseSideOrientation;

    this.material.setVector3('sunDirection', new Vector3(1, 0.5, 0).normalize());
    this.material.setVector3('planetCenter', Vector3.Zero());
    this.material.setFloats('planetRadius', [R]);
    this.material.setFloats('atmosphereHeight', [H]);
    this.material.setColor3('atmosphereColor', new Color3(0.4, 0.67, 1));

    this.mesh.material = this.material;
    this.mesh.renderingGroupId = 1;
  }

  getMesh(): Mesh {
    return this.mesh;
  }

  update(cameraPos: Vector3, sunDir: Vector3): void {
    this.material.setVector3('sunDirection', sunDir);
    // Planet center at render time = -camera.position (floating origin shift)
    this._tmpVec.copyFrom(cameraPos);
    this._tmpVec.negateInPlace();
    this.material.setVector3('planetCenter', this._tmpVec);
    this.mesh.position.set(0, 0, 0);
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }
}
