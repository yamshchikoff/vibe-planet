import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRenderer = vi.hoisted(() => ({
  setSize: vi.fn(),
  setPixelRatio: vi.fn(),
  render: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('three', async () => {
  const actual = await vi.importActual('three');
  return {
    ...(actual as object),
    WebGLRenderer: vi.fn(function () { return mockRenderer; }),
  };
});

import { SceneManager } from './SceneManager';

describe('SceneManager', () => {
  let canvas: HTMLCanvasElement;
  let sm: SceneManager;

  beforeEach(() => {
    vi.clearAllMocks();
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    sm = new SceneManager(canvas);
  });

  it('creates with a canvas element', () => {
    expect(sm).toBeDefined();
    sm.stop();
  });

  it('provides access to scene, camera, and renderer', () => {
    expect(sm.getScene()).toBeDefined();
    expect(sm.getCamera()).toBeDefined();
    expect(sm.getRenderer()).toBeDefined();
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

  describe('resize', () => {
    it('resize updates renderer size to window dimensions', () => {
      window.innerWidth = 1024;
      window.innerHeight = 768;
      sm.resize();
      expect(mockRenderer.setSize).toHaveBeenCalledWith(1024, 768);
    });

    it('resize updates camera aspect ratio', () => {
      window.innerWidth = 1024;
      window.innerHeight = 768;
      sm.resize();
      const cam = sm.getCamera();
      expect(cam.aspect).toBe(1024 / 768);
    });

    it('calls updateProjectionMatrix after resize', () => {
      const cam = sm.getCamera();
      const spy = vi.spyOn(cam, 'updateProjectionMatrix');
      window.innerWidth = 1024;
      window.innerHeight = 768;
      sm.resize();
      expect(spy).toHaveBeenCalled();
    });

    it('window resize event triggers SceneManager.resize', () => {
      window.innerWidth = 1024;
      window.innerHeight = 768;
      window.dispatchEvent(new Event('resize'));
      expect(mockRenderer.setSize).toHaveBeenCalledWith(1024, 768);
    });
  });
});
