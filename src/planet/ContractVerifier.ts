// Centralised assertion engine for LOD invariants I1–I10.
// All methods are static pure functions, guarded by `if (DEBUG)` at call sites.
// In production (DEBUG = false) tree-shaker eliminates all call trees.

import type { ChunkGeometry } from './ChunkGenerator';
import type { EdgeContract } from './BoundaryContractEngine';
import { Vector3 } from '@babylonjs/core';

// ── Debug toggle ─────────────────────────────────────────────────────────

/** Set to false in production builds — tree-shaker eliminates call trees. */
export let DEBUG = true;

// ── Tolerances ───────────────────────────────────────────────────────────

export const EPS_POSITION = 0.001;   // 1 mm for C⁰
export const EPS_NORMAL   = 1e-4;    // unit normal tolerance
export const EPS_ANGLE_DEG = 1.0;    // 1° for deterministic G¹
export const EPS_HEIGHT   = 0.001;   // height profile

// ── SharedEdge type ──────────────────────────────────────────────────────

export interface SharedEdge {
  /** Which edge on geometry A. */
  edgeA: 'left' | 'right' | 'bottom' | 'top';
  /** Which edge on geometry B. */
  edgeB: 'left' | 'right' | 'bottom' | 'top';
  /** Orientation of A's edge vertices. */
  orientationA: 'direct' | 'reversed';
  /** Orientation of B's edge vertices. */
  orientationB: 'direct' | 'reversed';
}

// ── Edge helpers ─────────────────────────────────────────────────────────

function edgeVertices(geo: ChunkGeometry, edge: 'left' | 'right' | 'bottom' | 'top', N: number): Float32Array[] {
  const res = N - 1;
  const result: Float32Array[] = [];
  const { positions } = geo;
  const push = (idx: number) => {
    result.push(new Float32Array([positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]]));
  };
  switch (edge) {
    case 'top':
      for (let col = 0; col <= res; col++) push(col);
      break;
    case 'bottom':
      for (let col = 0; col <= res; col++) push(res * N + col);
      break;
    case 'left':
      for (let row = 0; row <= res; row++) push(row * N);
      break;
    case 'right':
      for (let row = 0; row <= res; row++) push(row * N + res);
      break;
  }
  return result;
}

function vecLen(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

function posDist(a: Float32Array, b: Float32Array): number {
  return vecLen(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function faceAxis(face: number): number {
  return face <= 1 ? 0 : (face <= 3 ? 1 : 2);
}

function faceSign(face: number): number {
  return face % 2 === 0 ? 1 : -1;
}

// ── ContractVerifier ─────────────────────────────────────────────────────

export class ContractVerifier {
  // ── I1 ───────────────────────────────────────────────────────────────

  /** I1: every vertex must be within [R - ε, R + maxH + ε] of origin. */
  static checkRadialDistance(geometry: ChunkGeometry, R: number, maxH: number): void {
    if (!DEBUG) return;
    const { positions } = geometry;
    const eps = EPS_POSITION;
    const minR = R - eps;
    const maxR = R + maxH + eps;
    for (let i = 0; i < positions.length; i += 3) {
      const d = vecLen(positions[i], positions[i + 1], positions[i + 2]);
      if (d < minR || d > maxR) {
        throw new Error(`I1: vertex ${i / 3} radial distance ${d.toFixed(4)}, expected [${minR.toFixed(4)}, ${maxR.toFixed(4)}]`);
      }
    }
  }

  // ── I2 ───────────────────────────────────────────────────────────────

  /** I2: vertex count must equal (resolution + 1)². */
  static checkVertexCount(geometry: ChunkGeometry, resolution: number): void {
    if (!DEBUG) return;
    const expected = (resolution + 1) ** 2;
    const actual = geometry.positions.length / 3;
    if (actual !== expected) {
      throw new Error(`I2: vertex count ${actual}, expected ${expected}`);
    }
  }

  // ── I3 ───────────────────────────────────────────────────────────────

  /** I3: all normals must have unit length within EPS_NORMAL. */
  static checkNormals(geometry: ChunkGeometry): void {
    if (!DEBUG) return;
    const { normals } = geometry;
    for (let i = 0; i < normals.length; i += 3) {
      const len = vecLen(normals[i], normals[i + 1], normals[i + 2]);
      if (Math.abs(len - 1) > EPS_NORMAL) {
        throw new Error(`I3: normal ${i / 3} length ${len.toFixed(6)}`);
      }
    }
  }

  // ── I4 ───────────────────────────────────────────────────────────────

  /** I4: all vertices lie on the correct side of the face's primary axis. */
  static checkFaceOrigin(geometry: ChunkGeometry, face: number): void {
    if (!DEBUG) return;
    const axis = faceAxis(face);
    const sign = faceSign(face);
    const { positions } = geometry;
    for (let i = 0; i < positions.length; i += 3) {
      const val = positions[i + axis];
      if ((sign === 1 && val <= 0) || (sign === -1 && val >= 0)) {
        throw new Error(`I4: vertex ${i / 3} on wrong side of face axis ${axis}, sign=${sign} expected`);
      }
    }
  }

  // ── I5 ───────────────────────────────────────────────────────────────

  /** I5: internal seams of 4 split children must match. */
  static checkSplitSeams(children: ChunkGeometry[], tolerance: number): void {
    if (!DEBUG) return;
    if (children.length !== 4) {
      throw new Error(`I5: expected 4 children, got ${children.length}`);
    }
    const N0 = Math.round(Math.sqrt(children[0].positions.length / 3));
    const N1 = Math.round(Math.sqrt(children[1].positions.length / 3));
    const N2 = Math.round(Math.sqrt(children[2].positions.length / 3));
    const N3 = Math.round(Math.sqrt(children[3].positions.length / 3));
    if (N0 !== N1 || N1 !== N2 || N2 !== N3) {
      throw new Error('I5: children have inconsistent resolutions');
    }
    const N = N0;
    const res = N - 1;

    // Horizontal: tl bottom vs bl top
    const tlBottom = edgeVertices(children[0], 'bottom', N);
    const blTop = edgeVertices(children[2], 'top', N);
    for (let i = 0; i <= res; i++) {
      const d = posDist(tlBottom[i], blTop[i]);
      if (d > tolerance) {
        throw new Error(`I5: horizontal seam tl/bl at ${i}, delta ${d.toFixed(6)}`);
      }
    }
    // tr bottom vs br top
    const trBottom = edgeVertices(children[1], 'bottom', N);
    const brTop = edgeVertices(children[3], 'top', N);
    for (let i = 0; i <= res; i++) {
      const d = posDist(trBottom[i], brTop[i]);
      if (d > tolerance) {
        throw new Error(`I5: horizontal seam tr/br at ${i}, delta ${d.toFixed(6)}`);
      }
    }

    // Vertical: tl right vs tr left
    const tlRight = edgeVertices(children[0], 'right', N);
    const trLeft = edgeVertices(children[1], 'left', N);
    for (let i = 0; i <= res; i++) {
      const d = posDist(tlRight[i], trLeft[i]);
      if (d > tolerance) {
        throw new Error(`I5: vertical seam tl/tr at ${i}, delta ${d.toFixed(6)}`);
      }
    }
    // bl right vs br left
    const blRight = edgeVertices(children[2], 'right', N);
    const brLeft = edgeVertices(children[3], 'left', N);
    for (let i = 0; i <= res; i++) {
      const d = posDist(blRight[i], brLeft[i]);
      if (d > tolerance) {
        throw new Error(`I5: vertical seam bl/br at ${i}, delta ${d.toFixed(6)}`);
      }
    }

    // Center point: all 4 children share the center vertex
    const tlBR = edgeVertices(children[0], 'bottom', N)[res]; // bottom-right of tl
    const trBL = edgeVertices(children[1], 'bottom', N)[0];   // bottom-left of tr
    const blTR = edgeVertices(children[2], 'top', N)[res];    // top-right of bl
    const brTL = edgeVertices(children[3], 'top', N)[0];      // top-left of br
    const centerDeltas = [
      posDist(tlBR, trBL),
      posDist(tlBR, blTR),
      posDist(tlBR, brTL),
      posDist(trBL, blTR),
      posDist(trBL, brTL),
      posDist(blTR, brTL),
    ];
    const maxDelta = Math.max(...centerDeltas);
    if (maxDelta > tolerance) {
      throw new Error(`I5: center point delta ${maxDelta.toFixed(6)}`);
    }
  }

  // ── I6 ───────────────────────────────────────────────────────────────

  /** I6: external perimeter of children matches neighbor contracts. */
  static checkExternalPerimeter(
    children: ChunkGeometry[],
    neighborContracts: Map<string, EdgeContract>,
    eps: number,
  ): void {
    if (!DEBUG) return;
    const N = Math.round(Math.sqrt(children[0].positions.length / 3));

    // Assemble parent perimeter from children
    const perimeter: Record<string, Float32Array[]> = {
      left:   [...edgeVertices(children[0], 'left', N),   ...edgeVertices(children[2], 'left', N)],
      right:  [...edgeVertices(children[1], 'right', N),  ...edgeVertices(children[3], 'right', N)],
      top:    [...edgeVertices(children[0], 'top', N),    ...edgeVertices(children[1], 'top', N)],
      bottom: [...edgeVertices(children[2], 'bottom', N), ...edgeVertices(children[3], 'bottom', N)],
    };

    for (const [edge, contract] of neighborContracts) {
      if (!contract) continue;
      const assembled = perimeter[edge];
      if (!assembled) continue;
      const contractPositions = contract.vertexPositions;
      const maxLen = Math.min(assembled.length, contractPositions.length);
      for (let i = 0; i < maxLen; i++) {
        const a = assembled[i];
        const b = contractPositions[i];
        const d = a.length === 3
          ? vecLen(a[0] - b.x, a[1] - b.y, a[2] - b.z)
          : 0;
        if (d > eps) {
          throw new Error(`I6: external perimeter mismatch on ${edge} at ${i}, delta ${d.toFixed(6)}`);
        }
      }
    }
  }

  // ── I7 ───────────────────────────────────────────────────────────────

  /** I7: round-trip (split → merge) produces identical geometry. */
  static checkRoundTrip(
    original: ChunkGeometry,
    reconstructed: ChunkGeometry,
    eps: number,
  ): void {
    if (!DEBUG) return;

    if (original.positions.length !== reconstructed.positions.length) {
      throw new Error(`I7: vertex count mismatch ${original.positions.length} vs ${reconstructed.positions.length}`);
    }
    for (let i = 0; i < original.positions.length; i++) {
      const d = Math.abs(original.positions[i] - reconstructed.positions[i]);
      if (d > eps) {
        throw new Error(`I7: position mismatch at ${i}, delta ${d.toFixed(6)}`);
      }
    }

    for (let i = 0; i < original.normals.length; i++) {
      const d = Math.abs(original.normals[i] - reconstructed.normals[i]);
      if (d > eps) {
        throw new Error(`I7: normal mismatch at ${i}, delta ${d.toFixed(6)}`);
      }
    }
  }

  // ── I8 ───────────────────────────────────────────────────────────────

  /** I8: two edge contracts on a shared edge must match (C⁰, G¹, height). */
  static checkContractMatch(a: EdgeContract, b: EdgeContract, eps: number): void {
    if (!DEBUG) return;

    // Cross-depth: resample deeper to match shallower depth
    let aCmp = a;
    let bCmp = b;
    if (a.depth !== b.depth) {
      if (a.depth > b.depth) {
        aCmp = resampleContract(a, b.depth);
      } else {
        bCmp = resampleContract(b, a.depth);
      }
    }

    const vlen = Math.min(aCmp.vertexPositions.length, bCmp.vertexPositions.length);
    for (let i = 0; i < vlen; i++) {
      // C⁰
      const d = Vector3.Distance(aCmp.vertexPositions[i], bCmp.vertexPositions[i]);
      if (d > eps) {
        throw new Error(`I8: C⁰ at ${i}, delta ${d.toFixed(6)}`);
      }
      // Height
      if (i < aCmp.heightProfile.length && i < bCmp.heightProfile.length) {
        const hd = Math.abs(aCmp.heightProfile[i] - bCmp.heightProfile[i]);
        if (hd > eps) {
          throw new Error(`I8: height at ${i}, delta ${hd.toFixed(6)}`);
        }
      }
      // G¹
      if (i < aCmp.tangents.length && i < bCmp.tangents.length) {
        const tA = aCmp.tangents[i];
        const tB = bCmp.tangents[i];
        const dot = tA.x * tB.x + tA.y * tB.y + tA.z * tB.z;
        const lenA = vecLen(tA.x, tA.y, tA.z);
        const lenB = vecLen(tB.x, tB.y, tB.z);
        if (lenA > 1e-10 && lenB > 1e-10) {
          const cosAngle = Math.abs(dot) / (lenA * lenB);
          const angleDeg = (Math.acos(Math.min(1, cosAngle)) * 180) / Math.PI;
          if (angleDeg > EPS_ANGLE_DEG) {
            throw new Error(`I8: G¹ at ${i}, angle ${angleDeg.toFixed(2)}° > ${EPS_ANGLE_DEG}°`);
          }
        }
      }
    }
  }

  // ── I9 ───────────────────────────────────────────────────────────────

  /** I9: parent vertices match children vertices at shared positions (LOD coherence). */
  static checkLODCoherence(
    parentGeom: ChunkGeometry,
    childGeoms: ChunkGeometry[],
    tolerance: number,
  ): void {
    if (!DEBUG) return;
    if (childGeoms.length !== 4) {
      throw new Error(`I9: expected 4 children, got ${childGeoms.length}`);
    }

    const parentN = Math.round(Math.sqrt(parentGeom.positions.length / 3));
    const childN = Math.round(Math.sqrt(childGeoms[0].positions.length / 3));
    const parentHalf = Math.floor(parentN / 2);

    // Each child covers one quadrant of the parent. At LOD factor 2 (1 depth diff),
    // every 2nd row/col vertex in the child corresponds to a parent vertex.
    for (let ci = 0; ci < 4; ci++) {
      const child = childGeoms[ci];
      const rowOffset = Math.floor(ci / 2) * parentHalf;
      const colOffset = (ci % 2) * parentHalf;

      for (let r = 0; r < childN; r += 2) {
        for (let c = 0; c < childN; c += 2) {
          const pr = r / 2 + rowOffset;
          const pc = c / 2 + colOffset;
          if (pr >= parentN || pc >= parentN) continue;

          const parentIdx = pr * parentN + pc;
          const childIdx = r * childN + c;

          const px = parentGeom.positions[parentIdx * 3];
          const py = parentGeom.positions[parentIdx * 3 + 1];
          const pz = parentGeom.positions[parentIdx * 3 + 2];
          const cx = child.positions[childIdx * 3];
          const cy = child.positions[childIdx * 3 + 1];
          const cz = child.positions[childIdx * 3 + 2];

          const d = vecLen(px - cx, py - cy, pz - cz);
          if (d > tolerance) {
            throw new Error(`I9: LOD incoherence at parent (${pr},${pc}) child ${ci} (${r},${c}), delta ${d.toFixed(6)}`);
          }
        }
      }
    }
  }

  // ── I10 ──────────────────────────────────────────────────────────────

  /** I10: vertices on shared edges of different-face chunks must match. */
  static checkCrossFaceContinuity(
    geomA: ChunkGeometry,
    geomB: ChunkGeometry,
    sharedEdge: SharedEdge,
    tolerance: number,
  ): void {
    if (!DEBUG) return;

    const NA = Math.round(Math.sqrt(geomA.positions.length / 3));
    const NB = Math.round(Math.sqrt(geomB.positions.length / 3));

    let edgeA = edgeVertices(geomA, sharedEdge.edgeA, NA);
    let edgeB = edgeVertices(geomB, sharedEdge.edgeB, NB);

    if (sharedEdge.orientationA === 'reversed') edgeA = edgeA.reverse();
    if (sharedEdge.orientationB === 'reversed') edgeB = edgeB.reverse();

    const maxLen = Math.min(edgeA.length, edgeB.length);
    if (maxLen < 2) {
      throw new Error(`I10: edge too short (${maxLen}) for cross-face comparison`);
    }

    for (let i = 0; i < maxLen; i++) {
      const d = posDist(edgeA[i], edgeB[i]);
      if (d > tolerance) {
        throw new Error(`I10: cross-face discontinuity at ${i}, delta ${d.toFixed(6)}`);
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function resampleContract(contract: EdgeContract, targetDepth: number): EdgeContract {
  if (contract.depth === targetDepth) return contract;

  const diff = Math.abs(targetDepth - contract.depth);
  const factor = Math.pow(2, diff);
  const srcCount = contract.vertexPositions.length;

  if (diff > 0 && targetDepth > contract.depth) {
    // Up-resample: interpolate
    const dstCount = (srcCount - 1) * factor + 1;
    const newPositions: Vector3[] = new Array(dstCount);
    const newHeights: number[] = new Array(dstCount);
    for (let i = 0; i < srcCount - 1; i++) {
      const a = contract.vertexPositions[i];
      const b = contract.vertexPositions[i + 1];
      const ha = contract.heightProfile[i] ?? 0;
      const hb = contract.heightProfile[i + 1] ?? 0;
      for (let j = 0; j < factor; j++) {
        const t = j / factor;
        const idx = i * factor + j;
        newPositions[idx] = new Vector3(
          a.x + (b.x - a.x) * t,
          a.y + (b.y - a.y) * t,
          a.z + (b.z - a.z) * t,
        );
        newHeights[idx] = ha + (hb - ha) * t;
      }
    }
    const last = srcCount - 1;
    newPositions[(srcCount - 1) * factor] = new Vector3(
      contract.vertexPositions[last].x,
      contract.vertexPositions[last].y,
      contract.vertexPositions[last].z,
    );
    newHeights[(srcCount - 1) * factor] = contract.heightProfile[last] ?? 0;

    const newTangents = computeTangents(newPositions);
    return { ...contract, depth: targetDepth, vertexPositions: newPositions, heightProfile: newHeights, tangents: newTangents };
  } else {
    // Down-resample: decimate
    const dstCount = Math.floor((srcCount - 1) / factor) + 1;
    const newPositions: Vector3[] = new Array(dstCount);
    const newHeights: number[] = new Array(dstCount);
    for (let i = 0; i < dstCount; i++) {
      const si = i * factor;
      newPositions[i] = contract.vertexPositions[si];
      newHeights[i] = contract.heightProfile[si] ?? 0;
    }
    const newTangents = computeTangents(newPositions);
    return { ...contract, depth: targetDepth, vertexPositions: newPositions, heightProfile: newHeights, tangents: newTangents };
  }
}

function computeTangents(positions: Vector3[]): Vector3[] {
  if (positions.length < 2) return positions.map(() => new Vector3(0, 0, 0));
  const tangents: Vector3[] = [];
  for (let i = 0; i < positions.length; i++) {
    let dx: Vector3;
    if (i === 0) dx = positions[1].subtract(positions[0]);
    else if (i === positions.length - 1) dx = positions[i].subtract(positions[i - 1]);
    else dx = positions[i + 1].subtract(positions[i - 1]);
    const len = vecLen(dx.x, dx.y, dx.z);
    tangents.push(len > 1e-10 ? new Vector3(dx.x / len, dx.y / len, dx.z / len) : new Vector3(0, 0, 0));
  }
  return tangents;
}
