// LRU cache for generated terrain chunks.
// Owns entry lifecycle: insert, access, eviction by priority, dispose.
// No direct coupling to BoundaryContractEngine or DeformationSystem — uses
// onEvict callback for cleanup.

import { type Mesh } from '@babylonjs/core';
import type { ChunkGeometry } from './ChunkGenerator';

export interface ChunkCacheEntry {
  chunkId: string;
  mesh: Mesh | null;
  geometry: ChunkGeometry | null;
  lastAccess: number;
  state: 'ready' | 'generating' | 'evictable';
  generationPromise: Promise<ChunkGeometry> | null;
}

export interface CacheSubsystemOptions {
  maxSize?: number;
  onEvict?: (key: string, entry: ChunkCacheEntry) => void;
}

export class CacheSubsystem {
  private map: Map<string, ChunkCacheEntry>;
  private order: string[];       // LRU → MRU, index 0 = least recently used
  private maxSize: number;
  private onEvict?: (key: string, entry: ChunkCacheEntry) => void;

  constructor(options?: CacheSubsystemOptions) {
    this.map = new Map();
    this.order = [];
    this.maxSize = options?.maxSize ?? 1000;
    this.onEvict = options?.onEvict;
  }

  get(key: string): ChunkCacheEntry | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    entry.lastAccess = performance.now();
    this.moveToMru(key);
    return entry;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  touch(key: string): void {
    const entry = this.map.get(key);
    if (!entry) return;
    entry.lastAccess = performance.now();
    this.moveToMru(key);
  }

  put(key: string, entry: ChunkCacheEntry): void {
    // Overwrite existing
    if (this.map.has(key)) {
      const old = this.map.get(key)!;
      this.removeFromOrder(key);
      this.map.delete(key);
      this.onEvict?.(key, old);
    }

    // maxSize=0: reject immediately
    if (this.maxSize === 0) {
      this.onEvict?.(key, entry);
      return;
    }

    // Evict if at capacity
    while (this.map.size >= this.maxSize) {
      this.evict(1);
    }

    this.map.set(key, entry);
    this.order.push(key);
  }

  evict(count: number): string[] {
    if (count <= 0) return [];
    const evicted: string[] = [];

    // Phase 1: collect evictable entries in LRU order
    const evictable: string[] = [];
    for (let i = 0; i < this.order.length; i++) {
      const k = this.order[i];
      const entry = this.map.get(k);
      if (entry && entry.state === 'evictable') {
        evictable.push(k);
      }
    }

    // Phase 2: collect ready entries from LRU end, skip generating
    const ready: string[] = [];
    for (let i = 0; i < this.order.length; i++) {
      const k = this.order[i];
      const entry = this.map.get(k);
      if (!entry) continue;
      if (entry.state === 'evictable') continue;   // already in phase 1
      if (entry.state === 'generating') continue;   // skip
      ready.push(k);
    }

    // Combine: evictable first (in LRU order), then ready
    const candidates = evictable.concat(ready);

    for (let i = 0; i < candidates.length && evicted.length < count; i++) {
      const k = candidates[i];
      if (!this.map.has(k)) continue;
      const entry = this.map.get(k)!;
      this.removeFromOrder(k);
      this.map.delete(k);
      this.onEvict?.(k, entry);
      evicted.push(k);
    }

    return evicted;
  }

  getSize(): number {
    return this.map.size;
  }

  getMaxSize(): number {
    return this.maxSize;
  }

  dispose(): void {
    for (const [key, entry] of this.map) {
      this.onEvict?.(key, entry);
    }
    this.map.clear();
    this.order = [];
  }

  private moveToMru(key: string): void {
    this.removeFromOrder(key);
    this.order.push(key);
  }

  private removeFromOrder(key: string): void {
    const idx = this.order.indexOf(key);
    if (idx !== -1) {
      this.order.splice(idx, 1);
    }
  }
}
