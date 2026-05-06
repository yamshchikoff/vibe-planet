import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PCFSoftShadowMap } from 'three';

const mockRenderer = vi.hoisted(() => ({
  setSize: vi.fn(),
  setPixelRatio: vi.fn(),
  render: vi.fn(),
  dispose: vi.fn(),
  shadowMap: {
    enabled: false,
    type: 0,
  },
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

  it('default FOV is 75 (flight sim standard)', () => {
    expect(sm.getCamera().fov).toBe(75);
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

  it('renderer has shadow mapping enabled', () => {
    expect(sm.getRenderer().shadowMap.enabled).toBe(true);
    sm.stop();
  });

  it('shadow map uses PCFSoftShadowMap', () => {
    expect(sm.getRenderer().shadowMap.type).toBe(PCFSoftShadowMap);
    sm.stop();
  });

  describe('floating origin', () => {
    it('resets camera to origin after each frame', () => {
      vi.useFakeTimers();

      const cam = sm.getCamera();
      const worldGroup = sm.getWorldGroup();

      sm.onUpdate(() => {
        cam.position.set(100, 200, 300);
      });

      sm.start();

      vi.advanceTimersByTime(16);

      expect(worldGroup.position.x).toBe(-100);
      expect(worldGroup.position.y).toBe(-200);
      expect(worldGroup.position.z).toBe(-300);

      expect(cam.position.x).toBe(0);
      expect(cam.position.y).toBe(0);
      expect(cam.position.z).toBe(0);

      sm.stop();
      vi.useRealTimers();
    });
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
