import { Group, BoxGeometry, Mesh, MeshStandardMaterial } from 'three';

export class PlaneVisual {
  private group: Group;
  private meshes: Mesh[] = [];

  constructor() {
    this.group = new Group();

    const body = this.part(1.5, 0.3, 0.3, '#d0d0d0');
    body.position.set(0, 0, 0);

    const wings = this.part(0.1, 0.05, 3.0, '#b0b0b0');
    wings.position.set(0, 0, 0);

    const tail = this.part(0.3, 0.5, 0.1, '#909090');
    tail.position.set(-0.6, 0.15, 0);

    this.group.add(body, wings, tail);
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
