import { Scene, PerspectiveCamera, WebGLRenderer, Group, ACESFilmicToneMapping, Color, SRGBColorSpace } from 'three';

type UpdateCallback = (dt: number) => void;

export class SceneManager {
  private scene: Scene;
  private camera: PerspectiveCamera;
  private renderer: WebGLRenderer;
  private worldGroup: Group;
  private running = false;
  private rafId: number | null = null;
  private lastTime: number | null = null;
  private updateCallbacks: UpdateCallback[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = SRGBColorSpace;

    this.scene = new Scene();
    this.scene.background = new Color(0x050510);

    // Floating origin container: all world objects go here
    // Each frame, worldGroup.position = -camera.position to keep camera near origin
    this.worldGroup = new Group();
    this.scene.add(this.worldGroup);

    this.camera = new PerspectiveCamera(75, 1, 0.1, 2000000);
    this.camera.position.set(0, 6373, 0);

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  getWorldGroup(): Group {
    return this.worldGroup;
  }

  resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private loop = (time: number): void => {
    if (!this.running) return;

    if (this.lastTime !== null) {
      const dt = Math.min((time - this.lastTime) / 1000, 1 / 30);
      this.updateCallbacks.forEach((cb) => cb(dt));
    }
    this.lastTime = time;

    // Floating origin: keep camera at origin for rendering precision
    this.worldGroup.position.copy(this.camera.position).negate();
    this.camera.position.set(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.loop);
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastTime = null;
    window.removeEventListener('resize', this.resize);
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
