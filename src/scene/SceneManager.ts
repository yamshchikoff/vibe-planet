import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';

type UpdateCallback = (dt: number) => void;

export class SceneManager {
  private engine: Engine;
  private scene: Scene;
  private camera: FreeCamera;
  private worldGroup: TransformNode;
  private running = false;
  private lastTime: number | null = null;
  private updateCallbacks: UpdateCallback[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
    this.engine.disableUniformBuffers = true;

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.02, 0.02, 0.06, 1); // #050510

    this.camera = new FreeCamera('camera', Vector3.Zero(), this.scene);
    this.camera.fov = 75 * Math.PI / 180; // radians
    this.camera.minZ = 0.1;
    this.camera.maxZ = 2000000;

    this.worldGroup = new TransformNode('worldGroup', this.scene);

    // Non-zero reference point: without it, _currentTarget = position after
    // floating origin reset, and LookAtLH gets an undefined zero direction.
    (this.camera as any)._referencePoint = new Vector3(0, 0, 1000);
    (this.camera as any)._useRotationForTarget = true;

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  getWorldGroup(): TransformNode {
    return this.worldGroup;
  }

  resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.engine.setSize(w, h);
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();

    this.engine.runRenderLoop(() => {
      const time = performance.now();
      if (this.lastTime !== null) {
        const dt = Math.min((time - this.lastTime) / 1000, 1 / 30);
        for (const cb of this.updateCallbacks) {
          cb(dt);
        }
      }
      this.lastTime = time;

      // Floating origin: keep camera at origin, shift world objects
      this.worldGroup.position.copyFrom(this.camera.position.scale(-1));
      this.camera.position.set(0, 0, 0);

      this.scene.render();
    });
  }

  stop(): void {
    this.running = false;
    this.engine.stopRenderLoop();
    this.lastTime = null;
    window.removeEventListener('resize', this.resize);
  }

  onUpdate(cb: UpdateCallback): void {
    this.updateCallbacks.push(cb);
  }

  getScene(): Scene {
    return this.scene;
  }

  getCamera(): FreeCamera {
    return this.camera;
  }

  getEngine(): Engine {
    return this.engine;
  }
}
