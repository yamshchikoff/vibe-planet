import { describe, it, expect, vi, beforeEach } from 'vitest';

let loopFn: (() => void) | null = null;

const mockEngine = {
  runRenderLoop: vi.fn((fn: () => void) => { loopFn = fn; }),
  stopRenderLoop: vi.fn(() => { loopFn = null; }),
  setSize: vi.fn(),
  dispose: vi.fn(),
};

// Realistic Vec3 mock: stores x,y,z, supports scale/negate/copyFrom/set
function createVec3(x = 0, y = 0, z = 0) {
  const v = { x, y, z,
    set: vi.fn(function (nx: number, ny: number, nz: number) { v.x = nx; v.y = ny; v.z = nz; }),
    copyFrom: vi.fn(function (other: { x: number; y: number; z: number }) { v.x = other.x; v.y = other.y; v.z = other.z; }),
    scale: vi.fn(function (s: number) { return createVec3(v.x * s, v.y * s, v.z * s); }),
  };
  return v;
}

vi.mock('@babylonjs/core/Engines/engine', () => ({
  Engine: vi.fn().mockImplementation(function () { return mockEngine; }),
}));

vi.mock('@babylonjs/core/scene', () => ({
  Scene: vi.fn().mockImplementation(function () {
    return { render: vi.fn(), clearColor: { r: 0, g: 0, b: 0, a: 1 } };
  }),
}));

vi.mock('@babylonjs/core/Cameras/freeCamera', () => ({
  FreeCamera: vi.fn().mockImplementation(function () {
    return {
      position: createVec3(0, 0, 0),
      fov: 0,
      minZ: 0,
      maxZ: 0,
    };
  }),
}));

vi.mock('@babylonjs/core/Meshes/transformNode', () => ({
  TransformNode: vi.fn().mockImplementation(function () {
    return { position: createVec3(0, 0, 0) };
  }),
}));

import { SceneManager } from './SceneManager';

describe('SceneManager', () => {
  let canvas: HTMLCanvasElement;
  let sm: SceneManager;

  beforeEach(() => {
    vi.clearAllMocks();
    loopFn = null;
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    sm = new SceneManager(canvas);
  });

  it('creates with a canvas element', () => {
    expect(sm).toBeDefined();
    sm.stop();
  });

  it('provides access to scene, camera, and engine', () => {
    expect(sm.getScene()).toBeDefined();
    expect(sm.getCamera()).toBeDefined();
    expect(sm.getEngine()).toBeDefined();
    sm.stop();
  });

  it('default FOV is 75 degrees (~1.309 rad in Babylon.js)', () => {
    expect(sm.getCamera().fov).toBeCloseTo(1.309, 2);
    sm.stop();
  });

  it('start begins the render loop', () => {
    expect(() => sm.start()).not.toThrow();
    sm.stop();
  });

  it('can start and stop multiple times', () => {
    sm.start();
    sm.stop();
    sm.start();
    sm.stop();
    expect(true).toBe(true);
  });

  it('double start does not throw', () => {
    sm.start();
    expect(() => sm.start()).not.toThrow();
    sm.stop();
  });

  it('double stop does not throw', () => {
    sm.start();
    sm.stop();
    expect(() => sm.stop()).not.toThrow();
  });

  it('registers onUpdate callbacks', () => {
    const cb = vi.fn();
    expect(() => sm.onUpdate(cb)).not.toThrow();
    sm.stop();
  });

  describe('floating origin', () => {
    it('resets camera to origin after each frame', () => {
      const cam = sm.getCamera();
      const worldGroup = sm.getWorldGroup();

      sm.onUpdate(() => {
        cam.position.x = 100;
        cam.position.y = 200;
        cam.position.z = 300;
      });

      sm.start();
      loopFn?.();

      expect(worldGroup.position.x).toBe(-100);
      expect(worldGroup.position.y).toBe(-200);
      expect(worldGroup.position.z).toBe(-300);
      expect(cam.position.x).toBe(0);
      expect(cam.position.y).toBe(0);
      expect(cam.position.z).toBe(0);

      sm.stop();
    });
  });

  describe('resize', () => {
    it('resize updates engine size to window dimensions', () => {
      window.innerWidth = 1024;
      window.innerHeight = 768;
      sm.resize();
      expect(mockEngine.setSize).toHaveBeenCalledWith(1024, 768);
    });

    it('window resize event triggers resize', () => {
      window.innerWidth = 1024;
      window.innerHeight = 768;
      window.dispatchEvent(new Event('resize'));
      expect(mockEngine.setSize).toHaveBeenCalledWith(1024, 768);
    });
  });
});
