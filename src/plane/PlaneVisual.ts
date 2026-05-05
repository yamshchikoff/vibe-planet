import { Group, BoxGeometry, Mesh, MeshStandardMaterial } from 'three';

export class PlaneVisual {
  private group: Group;
  private meshes: Mesh[] = [];

  constructor() {
    this.group = new Group();
    this.group.scale.set(0.006, 0.006, 0.006);

    // Fuselage (along Z axis, nose at -Z) → 15m long × 1.8m wide
    const body = this.part(0.3, 0.3, 2.5, '#5a5a5a');
    body.position.set(0, 0, -0.2);

    // Nose → 1.5m
    const nose = this.part(0.2, 0.2, 0.25, '#4a4a4a');
    nose.position.set(0, 0, -1.35);

    // Cockpit canopy → 0.9m × 0.5m × 2m
    const cockpit = this.part(0.15, 0.08, 0.35, '#88ccff');
    cockpit.position.set(0, 0.15, -0.6);

    // Main wings (span along X) → 9m span
    const wings = this.part(1.5, 0.015, 0.08, '#6a6a6a');
    wings.position.set(0, -0.04, 0);

    // Horizontal stabilizers (tail wings) → 3m span
    const tailWings = this.part(0.5, 0.015, 0.06, '#6a6a6a');
    tailWings.position.set(0, -0.03, 0.8);

    // Vertical stabilizer (tail fin) → 2.1m tall
    const tailFin = this.part(0.03, 0.35, 0.06, '#5a5a5a');
    tailFin.position.set(0, 0.25, 0.7);

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
