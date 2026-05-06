import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';

export class PlaneVisual {
  private group: TransformNode;
  private meshes: Mesh[] = [];

  constructor(scene?: Scene) {
    this.group = new TransformNode('planeGroup', scene);
    this.group.scaling.set(0.006, 0.006, 0.006);

    // Fuselage (along Z axis, nose at -Z) → 15m long × 1.8m wide
    const body = this.part(0.3, 0.3, 2.5, '#5a5a5a', scene);
    body.position.set(0, 0, -0.2);

    // Nose → 1.5m
    const nose = this.part(0.2, 0.2, 0.25, '#4a4a4a', scene);
    nose.position.set(0, 0, -1.35);

    // Cockpit canopy → 0.9m × 0.5m × 2m
    const cockpit = this.part(0.15, 0.08, 0.35, '#88ccff', scene);
    cockpit.position.set(0, 0.15, -0.6);

    // Main wings (span along X) → 9m span
    const wings = this.part(1.5, 0.015, 0.08, '#6a6a6a', scene);
    wings.position.set(0, -0.04, 0);

    // Horizontal stabilizers (tail wings) → 3m span
    const tailWings = this.part(0.5, 0.015, 0.06, '#6a6a6a', scene);
    tailWings.position.set(0, -0.03, 0.8);

    // Vertical stabilizer (tail fin) → 2.1m tall
    const tailFin = this.part(0.03, 0.35, 0.06, '#5a5a5a', scene);
    tailFin.position.set(0, 0.25, 0.7);

    body.parent = this.group;
    nose.parent = this.group;
    cockpit.parent = this.group;
    wings.parent = this.group;
    tailWings.parent = this.group;
    tailFin.parent = this.group;
  }

  private part(w: number, h: number, d: number, color: string, scene?: Scene): Mesh {
    const mesh = MeshBuilder.CreateBox('part', { width: w, height: h, depth: d }, scene);
    const mat = new PBRMaterial('partMat', scene);
    mat.albedoColor = Color3.FromHexString(color);
    mat.metallic = 0.3;
    mat.roughness = 0.6;
    mesh.material = mat;
    mesh.receiveShadows = true;
    this.meshes.push(mesh);
    return mesh;
  }

  getMesh(): TransformNode {
    return this.group;
  }

  update(
    position: [number, number, number],
    yaw: number,
    pitch: number,
    roll: number
  ): void {
    this.group.position.set(position[0], position[1], position[2]);
    this.group.rotation.y = yaw;
    this.group.rotation.x = pitch;
    this.group.rotation.z = roll;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.dispose();
      const mat = mesh.material;
      if (mat) mat.dispose();
    }
    this.meshes = [];
  }
}
