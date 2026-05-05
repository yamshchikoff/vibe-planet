import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock WebGLRenderer before importing SceneManager
vi.mock('three', async () => {
  const actual = await vi.importActual('three');
  const mockRenderer = {
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  };
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
});
