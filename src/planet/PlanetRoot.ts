// PlanetRoot — facade for the cube-sphere LOD terrain system.
// Owns all 9 leaf subsystems and runs the per-frame LOD loop:
//   traverse → split → merge → ripple → generate → evict
//
// Sync-only generation in first release (AsyncJobScheduler exists but unused).
// Generation budget: up to 4 chunks per frame to keep frame times predictable.

import {
  Mesh,
  PBRMaterial,
  TransformNode,
  VertexData,
  type Camera,
  type Scene,
} from '@babylonjs/core';
import type { Edge } from './BoundaryContractEngine';
import { BoundaryContractEngine } from './BoundaryContractEngine';
import { CacheSubsystem, type ChunkCacheEntry } from './CacheSubsystem';
import { ChunkGenerator, type ChunkGeometry, type GenerateRequest } from './ChunkGenerator';
import { HeightSampler } from './HeightSampler';
import { LODEvaluator, type CameraParams, type LODEvaluation } from './LODEvaluator';
import { QuadtreeManager, type QuadNode, type NodeState } from './quadtree-manager';
import { AsyncJobScheduler, type WorkerProxy } from './async-job-scheduler';
import { ContractVerifier, DEBUG, EPS_POSITION } from './ContractVerifier';

// ── Config ──────────────────────────────────────────────────────────────────

export interface PlanetConfig {
  planetRadius: number;
  seed: number;
  heightAmplitude: number;
  maxDepth: number;
  chunkResolution: number;
  cacheSize: number;
}

const DEFAULTS: PlanetConfig = {
  planetRadius: 6371,
  seed: Math.random() * 2147483647,
  heightAmplitude: 8,
  maxDepth: 12,
  chunkResolution: 16,
  cacheSize: 1000,
};

// ── Per-frame traversal context ─────────────────────────────────────────────

interface SplitSignal {
  node: QuadNode;
  eval: LODEvaluation;
}

interface MergeSignal {
  parent: QuadNode;
  children: QuadNode[];
}

interface PendingLeaf {
  node: QuadNode;
  isVisible: boolean;
}

interface TraversalCtx {
  cameraParams: CameraParams;
  splitSignals: SplitSignal[];
  mergeSignals: MergeSignal[];
  pendingLeaves: PendingLeaf[];
  generationBudget: number;
  generatedThisFrame: number;
}

// ── Edge helpers ────────────────────────────────────────────────────────────

const ALL_EDGES: Edge[] = ['left', 'right', 'bottom', 'top'];

function oppositeEdge(e: Edge): Edge {
  switch (e) {
    case 'left': return 'right';
    case 'right': return 'left';
    case 'bottom': return 'top';
    case 'top': return 'bottom';
  }
}

// ── PlanetRoot ──────────────────────────────────────────────────────────────

export class PlanetRoot {
  private config: PlanetConfig;
  private scene: Scene;
  private rootTransform: TransformNode;

  // Subsystems
  private sampler: HeightSampler;
  private quadtree: QuadtreeManager;
  private lodEvaluator: LODEvaluator;
  private generator: ChunkGenerator;
  private boundaryEngine: BoundaryContractEngine;
  private cache: CacheSubsystem;
  private scheduler: AsyncJobScheduler;

  constructor(config: Partial<PlanetConfig>, scene: Scene) {
    this.config = { ...DEFAULTS, ...config };
    // Clamp edge cases per spec: radius=0 → 1, maxDepth=0 → 0 is valid (6 roots only)
    this.config.planetRadius = Math.max(1, this.config.planetRadius);
    this.scene = scene;
    this.rootTransform = new TransformNode('planetRoot', scene);

    this.sampler = new HeightSampler(this.config.seed);
    this.quadtree = new QuadtreeManager(this.config.maxDepth);
    this.lodEvaluator = new LODEvaluator(this.config.planetRadius, this.config.maxDepth);
    this.generator = new ChunkGenerator(this.sampler);
    this.boundaryEngine = new BoundaryContractEngine();
    this.scheduler = new AsyncJobScheduler(
      () => {
        const noopWorker: WorkerProxy = {
          postMessage: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          terminate: () => {},
          onmessage: null,
          onerror: null,
        };
        return noopWorker;
      },
    );
    this.cache = new CacheSubsystem({
      maxSize: this.config.cacheSize,
      onEvict: (key, entry) => {
        entry.mesh?.dispose();
        this.boundaryEngine.revoke(key);
      },
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Per-frame LOD update. Call once per frame from the render loop. */
  update(camera: Camera): void {
    const engine = this.scene.getEngine();
    const cameraParams = LODEvaluator.extractCameraParams(camera, engine);

    const ctx: TraversalCtx = {
      cameraParams,
      splitSignals: [],
      mergeSignals: [],
      pendingLeaves: [],
      generationBudget: 4,
      generatedThisFrame: 0,
    };

    // Phase 1: DFS traversal of all 6 roots
    for (const root of this.quadtree.getRoots()) {
      this.traverseNode(root, ctx);
    }

    // Phase 2: Split (before merge — split unblocks deeper traversal)
    for (const signal of ctx.splitSignals) {
      this.executeSplit(signal);
    }

    // Phase 3: Merge
    for (const signal of ctx.mergeSignals) {
      this.executeMerge(signal);
    }

    // Phase 4: Ripple — enforce max depth delta around split nodes
    for (const signal of ctx.splitSignals) {
      this.quadtree.enforceMaxDepthDelta(signal.node);
    }

    // Phase 5: Generate pending leaves
    this.generateLeaves(ctx);

    // Phase 6: Eviction
    if (this.cache.getSize() > this.config.cacheSize) {
      this.cache.evict(this.cache.getSize() - this.config.cacheSize);
    }
  }

  /** Sample terrain height at a world-space position (direct HeightSampler query). */
  getHeightAt(worldPos: { x: number; y: number; z: number }): number {
    return this.sampler.getHeight(worldPos.x, worldPos.y, worldPos.z);
  }

  /** Get the root TransformNode for parenting chunks. */
  getRoot(): TransformNode {
    return this.rootTransform;
  }

  /** BFS snapshot of all quadtree nodes. */
  getQuadtreeSnapshot(): { id: string; face: number; depth: number; tx: number; ty: number; state: NodeState }[] {
    const snapshot: { id: string; face: number; depth: number; tx: number; ty: number; state: NodeState }[] = [];
    const queue: QuadNode[] = [...this.quadtree.getRoots()];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const node = queue.shift()!;
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      snapshot.push({
        id: node.id,
        face: node.face,
        depth: node.depth,
        tx: node.tx,
        ty: node.ty,
        state: node.state,
      });
      if (node.children) {
        for (const child of node.children) {
          if (!visited.has(child.id)) queue.push(child);
        }
      }
    }

    return snapshot;
  }

  /** Dump all active edge contracts for debugging. */
  dumpContracts(): { chunkId: string; edge: Edge; contract: import('./BoundaryContractEngine').EdgeContract }[] {
    const result: { chunkId: string; edge: Edge; contract: import('./BoundaryContractEngine').EdgeContract }[] = [];
    const snapshot = this.getQuadtreeSnapshot();
    for (const node of snapshot) {
      if (node.state === 'loaded') {
        const contracts = this.boundaryEngine.getAllContracts(node.id);
        for (const contract of contracts) {
          result.push({ chunkId: node.id, edge: contract.edge, contract });
        }
      }
    }
    return result;
  }

  /** Release all resources. */
  dispose(): void {
    this.cache.dispose();
    this.scheduler.dispose();
    this.rootTransform.dispose();
  }

  // ── Private: traversal ───────────────────────────────────────────────────

  private traverseNode(node: QuadNode, ctx: TraversalCtx): void {
    const eval_ = this.lodEvaluator.evaluate(node, ctx.cameraParams);

    // Skip non-visible virtual nodes entirely
    if (!eval_.isVisible && node.state === 'virtual') return;

    if (node.state === 'split') {
      // Descend into children
      if (node.children) {
        for (const child of node.children) {
          this.traverseNode(child, ctx);
        }
      }
      // Check merge signal
      if (eval_.shouldMerge && node.children) {
        ctx.mergeSignals.push({ parent: node, children: node.children });
      }
      return;
    }

    // Virtual or loaded leaf
    if (eval_.shouldSplit && node.depth < this.config.maxDepth) {
      ctx.splitSignals.push({ node, eval: eval_ });
    } else if (node.state === 'virtual' && eval_.isVisible) {
      ctx.pendingLeaves.push({ node, isVisible: true });
    }
  }

  // ── Private: split ────────────────────────────────────────────────────────

  private executeSplit(signal: SplitSignal): void {
    if (signal.node.depth >= this.config.maxDepth) return;

    this.quadtree.split(signal.node);

    // DEBUG: verify internal seams of children
    if (DEBUG && signal.node.children) {
      const geometries: ChunkGeometry[] = [];
      for (const child of signal.node.children) {
        const entry = this.cache.get(child.id);
        if (entry?.geometry) geometries.push(entry.geometry);
      }
      if (geometries.length === 4) {
        ContractVerifier.checkSplitSeams(geometries, EPS_POSITION);
      }
    }
  }

  // ── Private: merge ────────────────────────────────────────────────────────

  private executeMerge(signal: MergeSignal): void {
    // Mark children as evictable
    for (const child of signal.children) {
      this.cache.put(child.id, {
        chunkId: child.id,
        mesh: null,
        geometry: null,
        lastAccess: 0,
        state: 'evictable',
        generationPromise: null,
      });
    }
    this.quadtree.merge(signal.children);
  }

  // ── Private: generation ───────────────────────────────────────────────────

  private generateLeaves(ctx: TraversalCtx): void {
    // Deterministic order: face-major 0→5, depth-minor, tx/ty lexicographic
    ctx.pendingLeaves.sort((a, b) => {
      if (a.node.face !== b.node.face) return a.node.face - b.node.face;
      if (a.node.depth !== b.node.depth) return a.node.depth - b.node.depth;
      if (a.node.tx !== b.node.tx) return a.node.tx - b.node.tx;
      return a.node.ty - b.node.ty;
    });

    for (const leaf of ctx.pendingLeaves) {
      if (ctx.generatedThisFrame >= ctx.generationBudget) break;

      // Cache hit — just touch
      if (this.cache.has(leaf.node.id)) {
        this.cache.touch(leaf.node.id);
        continue;
      }

      const request: GenerateRequest = {
        face: leaf.node.face,
        depth: leaf.node.depth,
        tx: leaf.node.tx,
        ty: leaf.node.ty,
        resolution: this.config.chunkResolution,
        planetRadius: this.config.planetRadius,
        heightAmplitude: this.config.heightAmplitude,
      };

      try {
        const geometry = this.generator.generateSync(request);
        const mesh = this.buildMesh(geometry, leaf.node.id, leaf.node.face);
        mesh.setParent(this.rootTransform);

        // Declare edge contracts
        for (const edge of ALL_EDGES) {
          this.boundaryEngine.declare(
            leaf.node.id,
            edge,
            geometry,
            this.config.planetRadius,
            this.config.heightAmplitude,
            { face: leaf.node.face, depth: leaf.node.depth },
          );
        }

        // Store in cache
        this.cache.put(leaf.node.id, {
          chunkId: leaf.node.id,
          mesh,
          geometry,
          lastAccess: performance.now(),
          state: 'ready',
          generationPromise: null,
        });

        // Mark node as loaded so future neighbor lookups find it
        leaf.node.state = 'loaded';

        // DEBUG: verify contracts with already-loaded neighbors
        if (DEBUG) {
          this.verifyNeighborContracts(leaf.node);
        }

        ctx.generatedThisFrame++;
      } catch (err) {
        console.error(`PlanetRoot: failed to generate chunk ${leaf.node.id}`, err);
      }
    }
  }

  // ── Private: mesh construction ───────────────────────────────────────────

  private buildMesh(geometry: ChunkGeometry, chunkId: string, _face: number): Mesh {
    const mesh = new Mesh(chunkId, this.scene);
    const vertexData = new VertexData();
    vertexData.positions = geometry.positions;
    vertexData.normals = geometry.normals;
    vertexData.colors = geometry.colors;
    vertexData.indices = geometry.indices;
    vertexData.applyToMesh(mesh, true);
    mesh.useVertexColors = true;

    const mat = new PBRMaterial(`mat-${chunkId}`, this.scene);
    mat.sideOrientation = 0; // CCW
    mat.roughness = 0.7;
    mat.metallic = 0.0;
    mesh.material = mat;
    mesh.receiveShadows = true;

    return mesh;
  }

  // ── Private: contract verification ───────────────────────────────────────

  private verifyNeighborContracts(node: QuadNode): void {
    for (const edge of ALL_EDGES) {
      const neighbor = this.quadtree.getNeighborAtDepth(node, edge, node.depth);
      if (!neighbor || neighbor.state !== 'loaded') continue;

      const myContract = this.boundaryEngine.getContract(node.id, edge);
      const neighborContract = this.boundaryEngine.getContract(neighbor.id, oppositeEdge(edge));
      if (myContract && neighborContract) {
        ContractVerifier.checkContractMatch(myContract, neighborContract, EPS_POSITION);
      }
    }
  }
}
