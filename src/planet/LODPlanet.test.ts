import { describe, it, expect } from 'vitest';
import { LODPlanet } from './LODPlanet';
import { Vector3, Mesh } from 'three';

describe('LODPlanet', () => {
  it('constructor does not throw', () => {
    expect(() => new LODPlanet({ seed: 42 })).not.toThrow();
  });

  it('getMesh returns a Group', () => {
    const p = new LODPlanet({ seed: 42 });
    const g = p.getMesh();
    expect(g.type).toBe('Group');
    p.dispose();
  });

  it('update generates chunks near camera', () => {
    const p = new LODPlanet({ seed: 42, maxDepth: 4, maxChunks: 100 });
    // Camera near the surface
    const camPos = new Vector3(0, 6373, 0);
    p.update(camPos);
    expect(p.getMesh().children.length).toBeGreaterThan(0);
    p.dispose();
  });

  it('getHeightAt returns reasonable value', () => {
    const p = new LODPlanet({ seed: 42, heightAmplitude: 8 });
    const h = p.getHeightAt(new Vector3(6371, 0, 0));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(1);
    p.dispose();
  });

  it('produces varied terrain across the sphere', () => {
    const p = new LODPlanet({ seed: 42, heightAmplitude: 8 });
    // Sample across the sphere — expect diverse height values
    const values: number[] = [];
    for (let i = 0; i < 50; i++) {
      const theta = (i * 0.5) % (Math.PI * 2);
      const phi = (i * 0.3) % Math.PI;
      const pos = new Vector3(
        6371 * Math.sin(phi) * Math.cos(theta),
        6371 * Math.cos(phi),
        6371 * Math.sin(phi) * Math.sin(theta)
      );
      values.push(p.getHeightAt(pos));
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    // Expect at least some variation
    expect(max - min).toBeGreaterThan(0.1);
    // And all values in [0, 1]
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
    p.dispose();
  });

  it('same seed generates same height', () => {
    const a = new LODPlanet({ seed: 42 });
    const b = new LODPlanet({ seed: 42 });
    const pos = new Vector3(6371, 0, 0);
    expect(a.getHeightAt(pos)).toBe(b.getHeightAt(pos));
    a.dispose();
    b.dispose();
  });

  it('different seeds generate different heights', () => {
    const a = new LODPlanet({ seed: 42 });
    const b = new LODPlanet({ seed: 99 });
    const pos = new Vector3(6371, 0, 0);
    // Very unlikely to be exactly the same with different seeds
    expect(a.getHeightAt(pos)).not.toBe(b.getHeightAt(pos));
    a.dispose();
    b.dispose();
  });

  it('dispose does not throw', () => {
    const p = new LODPlanet({ seed: 42, maxDepth: 3, maxChunks: 50 });
    p.update(new Vector3(0, 6373, 0));
    expect(() => p.dispose()).not.toThrow();
    expect(() => p.dispose()).not.toThrow(); // double dispose
  });

  it('update with very distant camera generates only low-detail chunks', () => {
    const p = new LODPlanet({ seed: 42, maxDepth: 8, maxChunks: 200 });
    // Camera very far (10x radius)
    p.update(new Vector3(0, 63710, 0));
    const count = p.getMesh().children.length;
    expect(count).toBeGreaterThan(0);
    // At this distance, should have fewer chunks than close-up
    const p2 = new LODPlanet({ seed: 42, maxDepth: 8, maxChunks: 200 });
    p2.update(new Vector3(0, 6373, 0));
    const closeCount = p2.getMesh().children.length;
    expect(closeCount).toBeGreaterThanOrEqual(count);
    p.dispose();
    p2.dispose();
  });

  it('accepts biomeWarpAmplitude config', () => {
    const p = new LODPlanet({ seed: 42, biomeWarpAmplitude: 0.1, maxDepth: 3, maxChunks: 50 });
    p.update(new Vector3(0, 6375, 0));
    expect(p.getMesh().children.length).toBeGreaterThan(0);
    p.dispose();
  });

  it('biome warp changes vertex colors compared to no warp', () => {
    const p1 = new LODPlanet({ seed: 42, biomeWarpAmplitude: 0, maxDepth: 3, maxChunks: 100 });
    const p2 = new LODPlanet({ seed: 42, biomeWarpAmplitude: 0.2, maxDepth: 3, maxChunks: 100 });
    const camPos = new Vector3(0, 6375, 0);
    p1.update(camPos);
    p2.update(camPos);

    // Compare color attributes of first chunk
    const children1 = p1.getMesh().children;
    const children2 = p2.getMesh().children;
    expect(children1.length).toBe(children2.length);
    if (children1.length > 0) {
      const mesh1 = children1[0] as Mesh;
      const mesh2 = children2[0] as Mesh;
      const colors1 = mesh1.geometry.getAttribute('color');
      const colors2 = mesh2.geometry.getAttribute('color');
      if (colors1 && colors2) {
        let anyDiff = false;
        for (let i = 0; i < colors1.count; i++) {
          if (
            colors1.getX(i) !== colors2.getX(i) ||
            colors1.getY(i) !== colors2.getY(i) ||
            colors1.getZ(i) !== colors2.getZ(i)
          ) {
            anyDiff = true;
            break;
          }
        }
        expect(anyDiff).toBe(true);
      }
    }
    p1.dispose();
    p2.dispose();
  });

  it('generated chunks have pbr attribute for per-vertex roughness/metalness', () => {
    const p = new LODPlanet({ seed: 42, maxDepth: 3, maxChunks: 50 });
    p.update(new Vector3(0, 6375, 0));
    const children = p.getMesh().children;
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      const mesh = child as Mesh;
      const pbr = mesh.geometry.getAttribute('pbr');
      expect(pbr).toBeDefined();
      expect(pbr.itemSize).toBe(2); // roughness + metalness
      // Values in [0, 1]
      for (let i = 0; i < pbr.count; i++) {
        expect(pbr.getX(i)).toBeGreaterThanOrEqual(0);
        expect(pbr.getX(i)).toBeLessThanOrEqual(1);
        expect(pbr.getY(i)).toBeGreaterThanOrEqual(0);
        expect(pbr.getY(i)).toBeLessThanOrEqual(1);
      }
    }
    p.dispose();
  });

  it('triangle normals face outward from sphere center', () => {
    const p = new LODPlanet({ seed: 42, maxDepth: 3, maxChunks: 100 });
    p.update(new Vector3(0, 6375, 0));

    const children = p.getMesh().children;
    expect(children.length).toBeGreaterThan(0);

    for (const child of children) {
      const mesh = child as Mesh;
      const pos = mesh.geometry.getAttribute('position');
      const idx = mesh.geometry.getIndex();
      if (!idx) continue;

      const indices = idx.array;
      const numTriangles = Math.min((indices.length as number) / 3, 5);

      for (let t = 0; t < numTriangles; t++) {
        const i0 = indices[t * 3] as number;
        const i1 = indices[t * 3 + 1] as number;
        const i2 = indices[t * 3 + 2] as number;

        const p0 = new Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
        const p1 = new Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
        const p2 = new Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2));

        const e1 = new Vector3().copy(p1).sub(p0);
        const e2 = new Vector3().copy(p2).sub(p0);
        const normal = new Vector3().crossVectors(e1, e2).normalize();

        // Outward direction from sphere center
        const outward = new Vector3().copy(p0).normalize();

        // Normal should point roughly outward (same hemisphere as vertex)
        const dot = normal.dot(outward);
        expect(dot).toBeGreaterThan(0);
      }
    }

    p.dispose();
  });
});
