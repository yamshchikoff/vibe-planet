import { Group, BoxGeometry, Mesh, MeshStandardMaterial } from 'three';

export class PlaneVisual {
  private group: Group;
  private meshes: Mesh[] = [];

  constructor() {
    this.group = new Group();

    // Fuselage
    const body = this.part(2.5, 0.35, 0.35, '#5a5a5a');
    body.position.set(0.2, 0, 0);

    // Nose
    const nose = this.part(0.3, 0.25, 0.25, '#4a4a4a');
    nose.position.set(1.35, 0, 0);

    // Cockpit
    const cockpit = this.part(0.4, 0.12, 0.2, '#88ccff');
    cockpit.position.set(0.6, 0.2, 0);

    // Main wings (swept by positioning at slight angle or just wide span)
    const wings = this.part(0.08, 0.04, 4.0, '#6a6a6a');
    wings.position.set(-0.1, -0.05, 0);

    // Horizontal stabilizers (tail wings)
    const tailWings = this.part(0.08, 0.04, 1.2, '#6a6a6a');
    tailWings.position.set(-0.8, -0.03, 0);

    // Vertical stabilizer (tail fin)
    const tailFin = this.part(0.08, 0.6, 0.3, '#5a5a5a');
    tailFin.position.set(-0.7, 0.3, 0);

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
