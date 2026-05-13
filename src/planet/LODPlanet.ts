// Backward-compatible re-export shim.
// New code should import { PlanetRoot } from './PlanetRoot' directly.
// uvToDir is re-exported from LODEvaluator for legacy usage.

import { PlanetRoot, type PlanetConfig } from './PlanetRoot';
import { uvToDir as _uvToDir } from './LODEvaluator';
import { HeightSampler } from './HeightSampler';
import type { Scene, Vector3 } from '@babylonjs/core';

export { _uvToDir as uvToDir };

export type LODConfig = PlanetConfig;

// Backward-compatible LODPlanet wrapper around PlanetRoot.
// When no scene is provided (e.g. in tests), only HeightSampler is created
// for getHeightAt calls. The old update(cameraPos) is a no-op — adaptive LOD
// is driven by PlanetRoot.update(camera) in the render loop.
export class LODPlanet {
  private sampler: HeightSampler;
  private inner: PlanetRoot | null = null;

  constructor(config?: Partial<PlanetConfig>, scene?: Scene) {
    this.sampler = new HeightSampler(config?.seed ?? Math.random() * 2147483647);
    if (scene) {
      this.inner = new PlanetRoot(config ?? {}, scene);
    }
  }

  getRoot() {
    if (!this.inner) throw new Error('LODPlanet: scene required for rendering');
    return this.inner.getRoot();
  }

  getHeightAt(worldPos: Vector3): number {
    return this.sampler.getHeight(worldPos.x, worldPos.y, worldPos.z);
  }

  update(_cameraPos: Vector3): void {
    // Legacy no-op: adaptive LOD uses PlanetRoot.update(camera)
  }

  dispose(): void {
    this.inner?.dispose();
  }
}

// Re-export the legacy LODPlanet as default for backward compat.
export default LODPlanet;
