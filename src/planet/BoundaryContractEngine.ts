// Edge contract system for C⁰/G¹ continuity between adjacent terrain chunks.
// Declares, stores, and verifies boundary contracts for each chunk edge.
// Supports cross-LOD verification via automatic resampling.

import { Vector3 } from '@babylonjs/core';
import type { ChunkGeometry } from './ChunkGenerator';

// ── Types ───────────────────────────────────────────────────────────────

export type Edge = 'left' | 'right' | 'bottom' | 'top';

export interface EdgeContract {
  chunkId: string;
  edge: Edge;
  face: number;
  depth: number;
  vertexPositions: Vector3[];
  heightProfile: number[];
  tangents: Vector3[];
  guaranteedDepth: number;
  g1Guarantee: 'deterministic' | 'stochastic';
  maxAngleDeg: number;
  timeBudgetMs: number;
  memoryBudgetBytes: number;
  seed: number;
  contentType: string;
  patchIds: string[];
}

export interface ContractVerificationResult {
  passed: boolean;
  failures: ContractFailure[];
}

export interface ContractFailure {
  type: 'position' | 'height' | 'tangent' | 'guaranteedDepth' | 'stochastic';
  severity: 'error' | 'warning';
  edgeVertexIndex: number;
  delta: number;
}

export interface InterContractEdge {
  edge: Edge;
  chunkA: EdgeContract;
  chunkB: EdgeContract;
  resampleMap: number[];
  verified: boolean;
}

export interface DeclareOptions {
  face?: number;
  depth?: number;
  guaranteedDepth?: number;
  g1Guarantee?: 'deterministic' | 'stochastic';
  maxAngleDeg?: number;
  timeBudgetMs?: number;
  memoryBudgetBytes?: number;
  seed?: number;
  contentType?: string;
  patchIds?: string[];
}

export interface VerifyOptions {
  epsPosition?: number;
  epsAngleDeg?: number;
}

// ── Constants ───────────────────────────────────────────────────────────

export const EPS_POSITION = 1e-6;
export const EPS_ANGLE_DEG = 0.1;

// ── BoundaryContractEngine ──────────────────────────────────────────────

export class BoundaryContractEngine {
  private store: Map<string, Map<Edge, EdgeContract>> = new Map();

  constructor() {}

  declare(
    chunkId: string,
    edge: Edge,
    geometry: ChunkGeometry,
    planetRadius: number,
    heightAmplitude: number,
    options?: DeclareOptions,
  ): EdgeContract {
    const N = Math.round(Math.sqrt(geometry.positions.length / 3));
    const resolution = N - 1;

    const positions = extractEdgeVertices(geometry, edge, N);
    const heightProfile = computeHeightProfile(positions, planetRadius, heightAmplitude);
    const tangents = computeEdgeTangents(positions);

    const contract: EdgeContract = {
      chunkId,
      edge,
      face: options?.face ?? 0,
      depth: options?.depth ?? 0,
      vertexPositions: positions,
      heightProfile,
      tangents,
      guaranteedDepth: options?.guaranteedDepth ?? 0,
      g1Guarantee: options?.g1Guarantee ?? 'deterministic',
      maxAngleDeg: options?.maxAngleDeg ?? EPS_ANGLE_DEG,
      timeBudgetMs: options?.timeBudgetMs ?? 16.6,
      memoryBudgetBytes: options?.memoryBudgetBytes ?? computeMemoryBudget(resolution),
      seed: options?.seed ?? 0,
      contentType: options?.contentType ?? 'terrain',
      patchIds: options?.patchIds ?? [],
    };

    // Store
    let edgeMap = this.store.get(chunkId);
    if (!edgeMap) {
      edgeMap = new Map();
      this.store.set(chunkId, edgeMap);
    }
    edgeMap.set(edge, contract);

    return contract;
  }

  verify(a: EdgeContract, b: EdgeContract, options?: VerifyOptions): ContractVerificationResult {
    const epsPos = options?.epsPosition ?? EPS_POSITION;
    const epsAngleRad = ((options?.epsAngleDeg ?? EPS_ANGLE_DEG) * Math.PI) / 180;
    const failures: ContractFailure[] = [];

    // Resample deeper contract to match shallower depth
    let aCmp = a;
    let bCmp = b;
    if (a.depth !== b.depth) {
      if (a.depth > b.depth) {
        aCmp = this.resample(a, b.depth);
      } else {
        bCmp = this.resample(b, a.depth);
      }
    }

    if (aCmp.vertexPositions.length !== bCmp.vertexPositions.length) {
      failures.push({
        type: 'position',
        severity: 'error',
        edgeVertexIndex: -1,
        delta: Math.abs(aCmp.vertexPositions.length - bCmp.vertexPositions.length),
      });
      return { passed: false, failures };
    }

    for (let i = 0; i < aCmp.vertexPositions.length; i++) {
      // C⁰: position match
      const dist = Vector3.Distance(aCmp.vertexPositions[i], bCmp.vertexPositions[i]);
      if (dist > epsPos) {
        failures.push({
          type: 'position',
          severity: 'error',
          edgeVertexIndex: i,
          delta: dist,
        });
        continue;
      }

      // Height match
      if (i < aCmp.heightProfile.length && i < bCmp.heightProfile.length) {
        const hDiff = Math.abs(aCmp.heightProfile[i] - bCmp.heightProfile[i]);
        if (hDiff > epsPos) {
          failures.push({
            type: 'height',
            severity: 'error',
            edgeVertexIndex: i,
            delta: hDiff,
          });
        }
      }

      // G¹: tangent angle
      if (i < aCmp.tangents.length && i < bCmp.tangents.length) {
        const tA = aCmp.tangents[i];
        const tB = bCmp.tangents[i];
        const dot = tA.x * tB.x + tA.y * tB.y + tA.z * tB.z;
        const lenA = Math.sqrt(tA.x * tA.x + tA.y * tA.y + tA.z * tA.z);
        const lenB = Math.sqrt(tB.x * tB.x + tB.y * tB.y + tB.z * tB.z);
        if (lenA > 1e-10 && lenB > 1e-10) {
          const cosAngle = Math.abs(dot) / (lenA * lenB);
          const angleRad = Math.acos(Math.min(1, cosAngle));
          if (angleRad > epsAngleRad) {
            failures.push({
              type: 'tangent',
              severity: 'error',
              edgeVertexIndex: i,
              delta: (angleRad * 180) / Math.PI,
            });
          }
        }
      }
    }

    return { passed: failures.length === 0, failures };
  }

  createInterface(chunkA: EdgeContract, chunkB: EdgeContract, edge: Edge): InterContractEdge {
    const deeper = chunkA.depth >= chunkB.depth ? chunkA : chunkB;
    const shallower = chunkA.depth < chunkB.depth ? chunkA : chunkB;
    const resampleMap = this.buildResampleMap(shallower.depth, deeper.depth, deeper.vertexPositions.length);

    return {
      edge,
      chunkA,
      chunkB,
      resampleMap,
      verified: false,
    };
  }

  resample(contract: EdgeContract, targetDepth: number): EdgeContract {
    if (contract.depth === targetDepth) {
      return { ...contract, vertexPositions: [...contract.vertexPositions], heightProfile: [...contract.heightProfile], tangents: [...contract.tangents] };
    }

    const diff = targetDepth - contract.depth;
    const factor = Math.pow(2, Math.abs(diff));
    const srcCount = contract.vertexPositions.length;
    let newPositions: Vector3[];
    let newHeights: number[];

    if (diff > 0) {
      // Up-resample: interpolate
      const dstCount = (srcCount - 1) * factor + 1;
      newPositions = new Array<Vector3>(dstCount);
      newHeights = new Array<number>(dstCount);
      for (let i = 0; i < srcCount - 1; i++) {
        const aPos = contract.vertexPositions[i];
        const bPos = contract.vertexPositions[i + 1];
        const aH = contract.heightProfile[i];
        const bH = contract.heightProfile[i + 1];
        for (let j = 0; j < factor; j++) {
          const t = j / factor;
          const idx = i * factor + j;
          newPositions[idx] = new Vector3(
            aPos.x + (bPos.x - aPos.x) * t,
            aPos.y + (bPos.y - aPos.y) * t,
            aPos.z + (bPos.z - aPos.z) * t,
          );
          newHeights[idx] = aH + (bH - aH) * t;
        }
      }
      const lastIdx = srcCount - 1;
      newPositions[(srcCount - 1) * factor] = new Vector3(
        contract.vertexPositions[lastIdx].x,
        contract.vertexPositions[lastIdx].y,
        contract.vertexPositions[lastIdx].z,
      );
      newHeights[(srcCount - 1) * factor] = contract.heightProfile[lastIdx];
    } else {
      // Down-resample: decimate
      const dstCount = Math.floor((srcCount - 1) / factor) + 1;
      newPositions = new Array<Vector3>(dstCount);
      newHeights = new Array<number>(dstCount);
      for (let i = 0; i < dstCount; i++) {
        const si = i * factor;
        if (si < srcCount) {
          newPositions[i] = contract.vertexPositions[si];
          newHeights[i] = contract.heightProfile[si];
        }
      }
    }

    const newTangents = computeEdgeTangents(newPositions);

    return {
      ...contract,
      depth: targetDepth,
      vertexPositions: newPositions,
      heightProfile: newHeights,
      tangents: newTangents,
    };
  }

  revoke(chunkId: string): void {
    this.store.delete(chunkId);
  }

  getContract(chunkId: string, edge: Edge): EdgeContract | undefined {
    return this.store.get(chunkId)?.get(edge);
  }

  getAllContracts(chunkId: string): EdgeContract[] {
    const edgeMap = this.store.get(chunkId);
    if (!edgeMap) return [];
    return Array.from(edgeMap.values());
  }

  buildResampleMap(shallowerDepth: number, deeperDepth: number, deeperVertexCount: number): number[] {
    if (shallowerDepth === deeperDepth) {
      return Array.from({ length: deeperVertexCount }, (_, i) => i);
    }
    const factor = Math.pow(2, Math.abs(deeperDepth - shallowerDepth));
    const map: number[] = [];
    for (let i = 0; i < deeperVertexCount; i++) {
      if (i % factor === 0) {
        map.push(i / factor);
      } else {
        // Interpolated vertex: map to the two surrounding shallower vertices
        map.push(-1);
      }
    }
    return map;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function extractEdgeVertices(geometry: ChunkGeometry, edge: Edge, N: number): Vector3[] {
  const { positions } = geometry;
  const resolution = N - 1;
  const result: Vector3[] = [];

  const push = (idx: number) => {
    result.push(new Vector3(positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]));
  };

  switch (edge) {
    case 'top':
      for (let col = 0; col <= resolution; col++) push(col);
      break;
    case 'bottom':
      for (let col = 0; col <= resolution; col++) push(resolution * N + col);
      break;
    case 'left':
      for (let row = 0; row <= resolution; row++) push(row * N);
      break;
    case 'right':
      for (let row = 0; row <= resolution; row++) push(row * N + resolution);
      break;
  }

  return result;
}

function computeHeightProfile(positions: Vector3[], planetRadius: number, heightAmplitude: number): number[] {
  if (heightAmplitude === 0) {
    return positions.map(() => 0);
  }
  return positions.map(p => {
    const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    return Math.max(0, Math.min(1, (dist - planetRadius) / heightAmplitude));
  });
}

function computeEdgeTangents(positions: Vector3[]): Vector3[] {
  if (positions.length < 2) {
    return positions.map(() => new Vector3(0, 0, 0));
  }

  const tangents: Vector3[] = [];

  for (let i = 0; i < positions.length; i++) {
    let dx: Vector3;
    if (i === 0) {
      dx = positions[1].subtract(positions[0]);
    } else if (i === positions.length - 1) {
      dx = positions[i].subtract(positions[i - 1]);
    } else {
      dx = positions[i + 1].subtract(positions[i - 1]);
    }
    const len = Math.sqrt(dx.x * dx.x + dx.y * dx.y + dx.z * dx.z);
    if (len > 1e-10) {
      tangents.push(new Vector3(dx.x / len, dx.y / len, dx.z / len));
    } else {
      tangents.push(new Vector3(0, 0, 0));
    }
  }

  return tangents;
}

function computeMemoryBudget(resolution: number): number {
  const N = resolution + 1;
  return (10 * N * N + 6 * resolution * resolution) * 4;
}
