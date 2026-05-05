import { Scene, PerspectiveCamera, WebGLRenderer } from 'three';

type UpdateCallback = (dt: number) => void;

export class SceneManager {
  private scene: Scene;
  private camera: PerspectiveCamera;
  private renderer: WebGLRenderer;
  private running = false;
  private rafId: number | null = null;
  private lastTime: number | null = null;
  private updateCallbacks: UpdateCallback[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(canvas.width, canvas.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new Scene();

    this.camera = new PerspectiveCamera(
      75,
      canvas.width / canvas.height,
      0.1,
      1000
    );
    this.camera.position.set(0, 5, 15);
    this.camera.lookAt(0, 0, 0);
  }

  private loop = (time: number): void => {
    if (!this.running) return;

    if (this.lastTime !== null) {
      const dt = Math.min((time - this.lastTime) / 1000, 1 / 30);
      this.updateCallbacks.forEach((cb) => cb(dt));
    }
    this.lastTime = time;

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.loop);
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = null;
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastTime = null;
  }

  onUpdate(cb: UpdateCallback): void {
    this.updateCallbacks.push(cb);
  }

  getScene(): Scene {
    return this.scene;
  }

  getCamera(): PerspectiveCamera {
    return this.camera;
  }

  getRenderer(): WebGLRenderer {
    return this.renderer;
  }
}
