import { Group, BoxGeometry, Mesh, MeshStandardMaterial } from 'three';

export class PlaneVisual {
  private group: Group;
  private meshes: Mesh[] = [];

  constructor() {
    this.group = new Group();
    this.group.scale.set(8, 8, 8);

    // Fuselage (along Z axis, nose at -Z)
    const body = this.part(0.35, 0.35, 2.5, '#5a5a5a');
    body.position.set(0, 0, -0.2);

    // Nose
    const nose = this.part(0.25, 0.25, 0.3, '#4a4a4a');
    nose.position.set(0, 0, -1.35);

    // Cockpit
    const cockpit = this.part(0.2, 0.12, 0.4, '#88ccff');
    cockpit.position.set(0, 0.2, -0.6);

    // Main wings (span along X axis)
    const wings = this.part(4.0, 0.04, 0.08, '#6a6a6a');
    wings.position.set(0, -0.05, 0.1);

    // Horizontal stabilizers (tail wings)
    const tailWings = this.part(1.2, 0.04, 0.08, '#6a6a6a');
    tailWings.position.set(0, -0.03, 0.8);

    // Vertical stabilizer (tail fin)
    const tailFin = this.part(0.3, 0.6, 0.08, '#5a5a5a');
    tailFin.position.set(0, 0.3, 0.7);

    this.group.add(body, nose, cockpit, wings, tailWings, tailFin);
  }

  private part(w: number, h: number, d: number, color: string): Mesh {
    const geo = new BoxGeometry(w, h, d);
    const mat = new MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.6 });
    const mesh = new Mesh(geo, mat);
    this.meshes.push(mesh);
    return mesh;
  }

  getMesh(): Group {
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
      mesh.geometry.dispose();
      const mat = mesh.material;
      if (!Array.isArray(mat)) mat.dispose();
      this.group.remove(mesh);
    }
    this.meshes = [];
  }
}
