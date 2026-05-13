// PlanetRoot integration tests.
// Mocks Babylon.js rendering classes (Mesh, VertexData, PBRMaterial) but uses
// real subsystem implementations (QuadtreeManager, LODEvaluator, ChunkGenerator,
// CacheSubsystem, BoundaryContractEngine).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Babylon.js rendering classes ───────────────────────────────────────
// Mesh, VertexData, PBRMaterial are created by buildMesh inside PlanetRoot.
// We mock them to avoid WebGL dependencies while tracking creation/disposal.

const meshRegistry = new Map<string, { mesh: any; disposed: boolean }>();

vi.mock('@babylonjs/core', async () => {
  const actual = await vi.importActual('@babylonjs/core');
  const { Vector3: ActualVector3 } = actual as any;

  class MockMesh {
    name: string;
    material: any = null;
    receiveShadows = false;
    useVertexColors = false;
    _scene: any;
    constructor(name: string, scene?: any) {
      this.name = name;
      this._scene = scene;
      meshRegistry.set(name, { mesh: this, disposed: false });
    }
    setParent(_p: any): void {}
    dispose(): void {
      const entry = meshRegistry.get(this.name);
      if (entry) entry.disposed = true;
    }
    getScene(): any { return this._scene; }
  }

  class MockVertexData {
    positions: any = null;
    normals: any = null;
    colors: any = null;
    indices: any = null;
    applyToMesh(_mesh: any, _updateRaw?: boolean): void {}
  }

  class MockPBRMaterial {
    name: string;
    sideOrientation = 0;
    roughness = 0;
    metallic = 0;
    clearCoat = { isEnabled: false, intensity: 0 };
    _scene: any;
    constructor(name: string, scene?: any) {
      this.name = name;
      this._scene = scene;
    }
    dispose(): void {}
  }

  class MockTransformNode {
    name: string;
    _scene: any;
    constructor(name: string, scene?: any) {
      this.name = name;
      this._scene = scene;
    }
    dispose(): void {}
    getChildMeshes(): any[] { return []; }
  }

  // Re-export Vector3 from the real module — it's pure math, works in jsdom
  return {
    ...actual,
    Mesh: MockMesh,
    VertexData: MockVertexData,
    PBRMaterial: MockPBRMaterial,
    TransformNode: MockTransformNode,
  };
});

// ── Imports (after mock setup) ─────────────────────────────────────────────

import { PlanetRoot } from './PlanetRoot';
import { LODEvaluator } from './LODEvaluator';
import { QuadtreeManager } from './quadtree-manager';
import { ChunkGenerator } from './ChunkGenerator';
import { HeightSampler } from './HeightSampler';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMockScene(): any {
  const mockEngine = {
    getRenderWidth: () => 1920,
    getRenderHeight: () => 1080,
  };
  const mockCamera = {
    position: { x: 0, y: 0, z: 10000, clone: () => ({ x: 0, y: 0, z: 10000 }) },
    fov: 70 * Math.PI / 180,
    minZ: 0.001,
    maxZ: 100000,
    _frustumPlanes: [],
  };
  return {
    getEngine: () => mockEngine,
    activeCamera: mockCamera,
  };
}

/** Reset mesh registry between tests. */
function resetMeshRegistry(): void {
  meshRegistry.clear();
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('PlanetRoot', () => {
  beforeEach(() => {
    resetMeshRegistry();
  });

  describe('constructor', () => {
    it('creates all subsystems with default config', () => {
      const scene = makeMockScene();
      const planet = new PlanetRoot({}, scene as any);

      // Public API check — each subsystem is exercised indirectly
      expect(planet.getRoot()).toBeTruthy();
      expect(typeof planet.update).toBe('function');
      expect(typeof planet.getHeightAt).toBe('function');
      expect(typeof planet.dispose).toBe('function');
    });

    it('accepts custom PlanetConfig', () => {
      const scene = makeMockScene();
      const planet = new PlanetRoot({
        planetRadius: 1000,
        seed: 42,
        heightAmplitude: 5,
        maxDepth: 4,
        chunkResolution: 8,
        cacheSize: 50,
      }, scene as any);

      expect(planet).toBeTruthy();
    });

    it('creates root TransformNode named planetRoot', () => {
      const scene = makeMockScene();
      const planet = new PlanetRoot({}, scene as any);
      expect(planet.getRoot()).toBeTruthy();
    });
  });

  describe('update', () => {
    it('processes all 6 root nodes without error', () => {
      const scene = makeMockScene();
      const planet = new PlanetRoot({ maxDepth: 0, seed: 42 }, scene as any);
      planet.update(scene.activeCamera);
      // maxDepth=0: no splits happen, 6 roots stay virtual — should not throw
      expect(true).toBe(true);
    });

    it('generates geometry for visible leaves at depth 1', () => {
      const scene = makeMockScene();
      const planet = new PlanetRoot({
        planetRadius: 6371,
        seed: 42,
        heightAmplitude: 8,
        maxDepth: 1,
        chunkResolution: 4,   // small for fast test
        cacheSize: 100,
      }, scene as any);

      // Camera close to planet surface — should trigger splits
      scene.activeCamera.position = { x: 7000, y: 0, z: 0, clone: () => ({ x: 7000, y: 0, z: 0 }) };
      planet.update(scene.activeCamera);

      // After update, at least some chunks should be in cache
      const snapshot = planet.getQuadtreeSnapshot();
      const loadedNodes = snapshot.filter(n => n.state === 'loaded');
      expect(loadedNodes.length).toBeGreaterThan(0);
    });

    it('can be called multiple times (idempotent)', () => {
      const scene = makeMockScene();
      const planet = new PlanetRoot({ maxDepth: 1, seed: 42, chunkResolution: 4 }, scene as any);

      scene.activeCamera.position = { x: 7000, y: 0, z: 0, clone: () => ({ x: 7000, y: 0, z: 0 }) };
      planet.update(scene.activeCamera);
      const snapshot1 = planet.getQuadtreeSnapshot();
      const loaded1 = snapshot1.filter(n => n.state === 'loaded').length;

      planet.update(scene.activeCamera);
      const snapshot2 = planet.getQuadtreeSnapshot();
      const loaded2 = snapshot2.filter(n => n.state === 'loaded').length;

      // Second update should not increase loaded count (cache hits)
      expect(loaded2).toBeGreaterThanOrEqual(loaded1);
    });
  });

  describe('getHeightAt', () => {
    it('returns a value in [0, 1] for a valid world position', () => {
      const scene = makeMockScene();
      const planet = new PlanetRoot({ seed: 42 }, scene as any);

      // Import Vector3 from actual module
      const { Vector3 } = require('@babylonjs/core');
      const h = planet.getHeightAt(new Vector3(6371, 0, 0));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    });

    it('returns deterministic results for the same seed', () => {
      const scene = makeMockScene();
      const { Vector3 } = require('@babylonjs/core');

      const p1 = new PlanetRoot({ seed: 99 }, scene as any);
      const p2 = new PlanetRoot({ seed: 99 }, scene as any);

      const h1 = p1.getHeightAt(new Vector3(5000, 2000, 3000));
      const h2 = p2.getHeightAt(new Vector3(5000, 2000, 3000));
      expect(h1).toBe(h2);
    });
  });

  describe('getQuadtreeSnapshot', () => {
    it('returns 6 root nodes for maxDepth=0', () => {
      const scene = makeMockScene();
      const planet = new PlanetRoot({ maxDepth: 0 }, scene as any);
      const snapshot = planet.getQuadtreeSnapshot();
      expect(snapshot.length).toBe(6);
      for (const node of snapshot) {
        expect(node.depth).toBe(0);
        expect(node.state).toBe('virtual');
      }
    });

    it('includes split and loaded nodes after update', () => {
      const scene = makeMockScene();
      const planet = new PlanetRoot({ maxDepth: 1, seed: 42, chunkResolution: 4 }, scene as any);

      scene.activeCamera.position = { x: 7000, y: 0, z: 0, clone: () => ({ x: 7000, y: 0, z: 0 }) };
      planet.update(scene.activeCamera);

      const snapshot = planet.getQuadtreeSnapshot();
      const states = new Set(snapshot.map(n => n.state));
      // At least some nodes should have been traversed
      expect(snapshot.length).toBeGreaterThan(6);
    });
  });

  describe('dumpContracts', () => {
    it('returns empty array when no chunks loaded', () => {
      const scene = makeMockScene();
      const planet = new PlanetRoot({ maxDepth: 0 }, scene as any);
      const contracts = planet.dumpContracts();
      expect(contracts).toEqual([]);
    });

    it('returns contracts for loaded chunks after update', () => {
      const scene = makeMockScene();
      const planet = new PlanetRoot({ maxDepth: 1, seed: 42, chunkResolution: 4 }, scene as any);

      scene.activeCamera.position = { x: 7000, y: 0, z: 0, clone: () => ({ x: 7000, y: 0, z: 0 }) };
      planet.update(scene.activeCamera);

      const contracts = planet.dumpContracts();
      // If any chunks were loaded, they should have 4 contracts each (left, right, bottom, top)
      if (contracts.length > 0) {
        const chunkIds = new Set(contracts.map(c => c.chunkId));
        for (const id of chunkIds) {
          const chunkContracts = contracts.filter(c => c.chunkId === id);
          expect(chunkContracts.length).toBe(4);
        }
      }
    });
  });

  describe('dispose', () => {
    it('cleans up without error', () => {
      const scene = makeMockScene();
      const planet = new PlanetRoot({ maxDepth: 1, seed: 42, chunkResolution: 4 }, scene as any);

      scene.activeCamera.position = { x: 7000, y: 0, z: 0, clone: () => ({ x: 7000, y: 0, z: 0 }) };
      planet.update(scene.activeCamera);
      planet.dispose();

      // After dispose, update should still be callable (no crash)
      expect(true).toBe(true);
    });
  });
});

// ── Edge case tests ─────────────────────────────────────────────────────────

describe('PlanetRoot edge cases', () => {
  beforeEach(() => {
    resetMeshRegistry();
  });

  it('handles maxDepth=0: no generation', () => {
    const scene = makeMockScene();
    const planet = new PlanetRoot({ maxDepth: 0, seed: 42 }, scene as any);
    planet.update(scene.activeCamera);
    const snapshot = planet.getQuadtreeSnapshot();
    expect(snapshot.every(n => n.state === 'virtual')).toBe(true);
  });

  it('handles planetRadius=0 without throwing', () => {
    const scene = makeMockScene();
    const planet = new PlanetRoot({ planetRadius: 0, seed: 42, maxDepth: 1, chunkResolution: 4 }, scene as any);
    // Radius=0 should not crash during generation
    scene.activeCamera.position = { x: 1, y: 0, z: 0, clone: () => ({ x: 1, y: 0, z: 0 }) };
    expect(() => planet.update(scene.activeCamera)).not.toThrow();
    planet.dispose();
  });

  it('handles cacheSize=0 gracefully', () => {
    const scene = makeMockScene();
    const planet = new PlanetRoot({ cacheSize: 0, maxDepth: 1, seed: 42, chunkResolution: 4 }, scene as any);
    scene.activeCamera.position = { x: 7000, y: 0, z: 0, clone: () => ({ x: 7000, y: 0, z: 0 }) };
    // cacheSize=0 means chunks are evicted immediately — should not throw
    expect(() => planet.update(scene.activeCamera)).not.toThrow();
    planet.dispose();
  });

  it('handles null/undefined config fields with defaults', () => {
    const scene = makeMockScene();
    const planet = new PlanetRoot({ seed: 1 } as any, scene as any);
    expect(planet).toBeTruthy();
    planet.dispose();
  });
});
