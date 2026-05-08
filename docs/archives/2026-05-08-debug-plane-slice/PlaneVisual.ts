import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';

export class PlaneVisual {
  private group: TransformNode;
  private meshes: Mesh[] = [];

  constructor(scene?: Scene) {
    this.group = new TransformNode('planeGroup', scene);
    this.group.scaling.set(1.5, 1.5, 1.5);

    // Coordinate remap: old Z-forward frame → new X-forward body frame (X=forward, Y=right, Z=up)
    // old (x, y, z) → new (-z, x, y), old dims (w, h, d) → new (d, w, h)

    // Fuselage → 15m long, along +X
    const body = this.part(2.5, 0.3, 0.3, '#5a5a5a', scene);
    body.position.set(0.2, 0, 0);

    // Nose → 1.5m forward of fuselage
    const nose = this.part(0.25, 0.2, 0.2, '#4a4a4a', scene);
    nose.position.set(1.35, 0, 0);

    // Cockpit canopy → 2m × 0.9m × 0.5m
    const cockpit = this.part(0.35, 0.15, 0.08, '#88ccff', scene);
    cockpit.position.set(0.6, 0, 0.15);

    // Main wings → 9m span along Y
    const wings = this.part(0.08, 1.5, 0.015, '#6a6a6a', scene);
    wings.position.set(0, 0, -0.04);

    // Horizontal stabilizers → 3m span along Y
    const tailWings = this.part(0.06, 0.5, 0.015, '#6a6a6a', scene);
    tailWings.position.set(-0.8, 0, -0.03);

    // Vertical stabilizer → 2.1m tall along Z
    const tailFin = this.part(0.06, 0.03, 0.35, '#5a5a5a', scene);
    tailFin.position.set(-0.7, 0, 0.25);

    body.parent = this.group;
    nose.parent = this.group;
    cockpit.parent = this.group;
    wings.parent = this.group;
    tailWings.parent = this.group;
    tailFin.parent = this.group;
  }

  private part(w: number, h: number, d: number, color: string, scene?: Scene): Mesh {
    const mesh = MeshBuilder.CreateBox('part', { width: w, height: h, depth: d }, scene);
    const mat = new StandardMaterial('partMat', scene);
    mat.diffuseColor = Color3.FromHexString(color);
    mat.specularColor = Color3.FromHexString(color).scale(0.3);
    mat.emissiveColor = Color3.FromHexString(color);
    mesh.material = mat;
    mesh.receiveShadows = true;
    mesh.alwaysSelectAsActiveMesh = true;
    this.meshes.push(mesh);
    return mesh;
  }

  getMesh(): TransformNode {
    return this.group;
  }

  update(position: [number, number, number], quat: Quaternion): void {
    this.group.position.set(position[0], position[1], position[2]);
    this.group.rotationQuaternion = quat;
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
