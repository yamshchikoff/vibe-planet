import { describe, it, expect, vi } from 'vitest';
import { CacheSubsystem, type ChunkCacheEntry, type CacheSubsystemOptions } from './CacheSubsystem';
import type { Mesh } from '@babylonjs/core';

// ── Fixtures ────────────────────────────────────────────────────────────

let time = 0;
function makeEntry(overrides?: Partial<ChunkCacheEntry>): ChunkCacheEntry {
  const entry: ChunkCacheEntry = {
    chunkId: overrides?.chunkId ?? 'chunk',
    mesh: { dispose: vi.fn() } as unknown as Mesh,
    geometry: null,
    lastAccess: time++,
    state: 'ready',
    generationPromise: null,
    ...overrides,
  };
  return entry;
}

function makeCache(opts?: CacheSubsystemOptions): CacheSubsystem {
  return new CacheSubsystem(opts);
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('CacheSubsystem', () => {
  describe('constructor', () => {
    it('default maxSize is 1000', () => {
      const c = makeCache();
      expect(c.getMaxSize()).toBe(1000);
    });

    it('custom maxSize', () => {
      const c = makeCache({ maxSize: 50 });
      expect(c.getMaxSize()).toBe(50);
    });

    it('maxSize=0', () => {
      const c = makeCache({ maxSize: 0 });
      expect(c.getMaxSize()).toBe(0);
    });

    it('starts empty', () => {
      const c = makeCache();
      expect(c.getSize()).toBe(0);
    });

    it('stores onEvict callback', () => {
      const onEvict = vi.fn();
      const c = makeCache({ onEvict });
      c.put('a', makeEntry({ chunkId: 'a' }));
      c.evict(1);
      expect(onEvict).toHaveBeenCalledTimes(1);
    });
  });

  describe('put', () => {
    it('adds entry to cache', () => {
      const c = makeCache();
      c.put('a', makeEntry({ chunkId: 'a' }));
      expect(c.getSize()).toBe(1);
    });

    it('get returns the entry after put', () => {
      const c = makeCache();
      const entry = makeEntry({ chunkId: 'x' });
      c.put('x', entry);
      expect(c.get('x')).toBe(entry);
    });

    it('overwrites existing key, calls onEvict for old entry', () => {
      const onEvict = vi.fn();
      const c = makeCache({ onEvict });
      const oldEntry = makeEntry({ chunkId: 'k' });
      const newEntry = makeEntry({ chunkId: 'k' });
      c.put('k', oldEntry);
      c.put('k', newEntry);
      expect(c.get('k')).toBe(newEntry);
      expect(onEvict).toHaveBeenCalledWith('k', oldEntry);
    });

    it('auto-evicts LRU entry when over capacity', () => {
      const onEvict = vi.fn();
      const c = makeCache({ maxSize: 2, onEvict });
      c.put('a', makeEntry({ chunkId: 'a' }));
      c.put('b', makeEntry({ chunkId: 'b' }));
      expect(c.getSize()).toBe(2);
      c.put('c', makeEntry({ chunkId: 'c' }));
      expect(c.getSize()).toBe(2);
      expect(onEvict).toHaveBeenCalledWith('a', expect.anything());
      expect(c.get('a')).toBeUndefined();
    });

    it('maxSize=0: does not store, calls onEvict immediately', () => {
      const onEvict = vi.fn();
      const c = makeCache({ maxSize: 0, onEvict });
      c.put('a', makeEntry({ chunkId: 'a' }));
      expect(c.getSize()).toBe(0);
      expect(c.get('a')).toBeUndefined();
      expect(onEvict).toHaveBeenCalledWith('a', expect.anything());
    });

    it('null mesh and geometry allowed', () => {
      const c = makeCache();
      c.put('n', makeEntry({ chunkId: 'n', mesh: null, geometry: null }));
      const entry = c.get('n');
      expect(entry).toBeDefined();
      expect(entry!.mesh).toBeNull();
      expect(entry!.geometry).toBeNull();
    });
  });

  describe('get', () => {
    it('returns entry for existing key', () => {
      const c = makeCache();
      const entry = makeEntry({ chunkId: 'k' });
      c.put('k', entry);
      expect(c.get('k')).toBe(entry);
    });

    it('returns undefined for missing key', () => {
      const c = makeCache();
      expect(c.get('missing')).toBeUndefined();
    });

    it('updates lastAccess on get', () => {
      const c = makeCache();
      c.put('a', makeEntry({ chunkId: 'a', lastAccess: 10 }));
      c.get('a');
      expect(c.get('a')!.lastAccess).toBeGreaterThan(10);
    });
  });

  describe('has', () => {
    it('returns true for existing key', () => {
      const c = makeCache();
      c.put('k', makeEntry({ chunkId: 'k' }));
      expect(c.has('k')).toBe(true);
    });

    it('returns false for missing key', () => {
      const c = makeCache();
      expect(c.has('missing')).toBe(false);
    });

    it('does not change LRU order', () => {
      const c = makeCache({ maxSize: 2 });
      c.put('a', makeEntry({ chunkId: 'a' }));
      c.put('b', makeEntry({ chunkId: 'b' }));
      c.has('a'); // should NOT move 'a' to MRU
      c.put('c', makeEntry({ chunkId: 'c' }));
      // 'a' is still LRU → evicted
      expect(c.get('a')).toBeUndefined();
      expect(c.get('b')).toBeDefined();
      expect(c.get('c')).toBeDefined();
    });
  });

  describe('touch', () => {
    it('updates lastAccess for existing key', () => {
      const c = makeCache();
      c.put('k', makeEntry({ chunkId: 'k', lastAccess: 10 }));
      c.touch('k');
      expect(c.get('k')!.lastAccess).toBeGreaterThan(10);
    });

    it('no-op for missing key', () => {
      const c = makeCache();
      expect(() => c.touch('missing')).not.toThrow();
    });
  });

  describe('LRU ordering', () => {
    it('put appends entries in order', () => {
      const c = makeCache({ maxSize: 3 });
      c.put('a', makeEntry({ chunkId: 'a' }));
      c.put('b', makeEntry({ chunkId: 'b' }));
      c.put('c', makeEntry({ chunkId: 'c' }));
      // evict(1) removes LRU = 'a'
      const evicted = c.evict(1);
      expect(evicted).toEqual(['a']);
    });

    it('get moves entry to MRU', () => {
      const c = makeCache({ maxSize: 2 });
      c.put('a', makeEntry({ chunkId: 'a' }));
      c.put('b', makeEntry({ chunkId: 'b' }));
      c.get('a'); // move 'a' to MRU
      c.put('c', makeEntry({ chunkId: 'c' }));
      // 'b' is now LRU → evicted
      expect(c.get('b')).toBeUndefined();
      expect(c.get('a')).toBeDefined();
    });

    it('touch moves entry to MRU', () => {
      const c = makeCache({ maxSize: 2 });
      c.put('a', makeEntry({ chunkId: 'a' }));
      c.put('b', makeEntry({ chunkId: 'b' }));
      c.touch('a');
      c.put('c', makeEntry({ chunkId: 'c' }));
      expect(c.get('b')).toBeUndefined();
      expect(c.get('a')).toBeDefined();
    });

    it('has does NOT move entry to MRU', () => {
      const c = makeCache({ maxSize: 2 });
      c.put('a', makeEntry({ chunkId: 'a' }));
      c.put('b', makeEntry({ chunkId: 'b' }));
      c.has('a');
      c.put('c', makeEntry({ chunkId: 'c' }));
      expect(c.get('a')).toBeUndefined();
      expect(c.get('b')).toBeDefined();
    });

    it('evict removes from LRU end (index 0)', () => {
      const c = makeCache({ maxSize: 3 });
      c.put('a', makeEntry({ chunkId: 'a' }));
      c.put('b', makeEntry({ chunkId: 'b' }));
      c.put('c', makeEntry({ chunkId: 'c' }));
      expect(c.evict(1)).toEqual(['a']);
      expect(c.evict(1)).toEqual(['b']);
      expect(c.evict(1)).toEqual(['c']);
    });
  });

  describe('evict', () => {
    it('removes exact count', () => {
      const c = makeCache({ maxSize: 5 });
      for (const k of ['a', 'b', 'c', 'd', 'e']) {
        c.put(k, makeEntry({ chunkId: k }));
      }
      const evicted = c.evict(2);
      expect(evicted).toEqual(['a', 'b']);
      expect(c.getSize()).toBe(3);
    });

    it('count > size: removes all', () => {
      const c = makeCache({ maxSize: 3 });
      c.put('a', makeEntry({ chunkId: 'a' }));
      c.put('b', makeEntry({ chunkId: 'b' }));
      const evicted = c.evict(10);
      expect(evicted).toEqual(['a', 'b']);
      expect(c.getSize()).toBe(0);
    });

    it('evict(0) returns empty array', () => {
      const c = makeCache();
      c.put('a', makeEntry({ chunkId: 'a' }));
      expect(c.evict(0)).toEqual([]);
      expect(c.getSize()).toBe(1);
    });

    it('empty cache: returns empty array', () => {
      const c = makeCache();
      expect(c.evict(1)).toEqual([]);
    });

    it('returns array of evicted chunkIds', () => {
      const c = makeCache({ maxSize: 3 });
      c.put('a', makeEntry({ chunkId: 'a' }));
      c.put('b', makeEntry({ chunkId: 'b' }));
      c.put('c', makeEntry({ chunkId: 'c' }));
      expect(c.evict(2)).toEqual(['a', 'b']);
    });

    it('calls onEvict for each evicted entry', () => {
      const onEvict = vi.fn();
      const c = makeCache({ maxSize: 3, onEvict });
      c.put('a', makeEntry({ chunkId: 'a' }));
      c.put('b', makeEntry({ chunkId: 'b' }));
      c.evict(2);
      expect(onEvict).toHaveBeenCalledTimes(2);
      expect(onEvict).toHaveBeenCalledWith('a', expect.objectContaining({ chunkId: 'a' }));
      expect(onEvict).toHaveBeenCalledWith('b', expect.objectContaining({ chunkId: 'b' }));
    });
  });

  describe('eviction priority: evictable first', () => {
    it('evictable entries evicted before ready entries', () => {
      const c = makeCache({ maxSize: 5 });
      c.put('a', makeEntry({ chunkId: 'a' }));
      c.put('b', makeEntry({ chunkId: 'b', state: 'evictable' }));
      c.put('c', makeEntry({ chunkId: 'c' }));
      c.put('d', makeEntry({ chunkId: 'd', state: 'evictable' }));
      c.put('e', makeEntry({ chunkId: 'e' }));
      // evict(2): should remove evictable entries first
      const evicted = c.evict(2);
      expect(evicted).toContain('b');
      expect(evicted).toContain('d');
      expect(c.get('b')).toBeUndefined();
      expect(c.get('d')).toBeUndefined();
      expect(c.get('a')).toBeDefined();
    });

    it('evictable entries in LRU order among themselves', () => {
      const c = makeCache({ maxSize: 5 });
      c.put('ev1', makeEntry({ chunkId: 'ev1', state: 'evictable' }));
      c.put('ready1', makeEntry({ chunkId: 'ready1' }));
      c.put('ev2', makeEntry({ chunkId: 'ev2', state: 'evictable' }));
      c.put('ready2', makeEntry({ chunkId: 'ready2' }));
      c.put('ev3', makeEntry({ chunkId: 'ev3', state: 'evictable' }));
      // evict(2): should remove ev1 and ev2 (LRU among evictable)
      const evicted = c.evict(2);
      expect(evicted).toEqual(['ev1', 'ev2']);
    });

    it('if not enough evictable, evicts from ready LRU', () => {
      const c = makeCache({ maxSize: 5 });
      c.put('ev1', makeEntry({ chunkId: 'ev1', state: 'evictable' }));
      c.put('a', makeEntry({ chunkId: 'a' }));
      c.put('b', makeEntry({ chunkId: 'b' }));
      c.put('c', makeEntry({ chunkId: 'c' }));
      // evict(3): ev1 (evictable) + a, b (LRU ready)
      const evicted = c.evict(3);
      expect(evicted).toContain('ev1');
      expect(evicted).toContain('a');
      expect(evicted).toContain('b');
      expect(c.get('c')).toBeDefined();
    });

    it('generating entries are skipped during evict', () => {
      const c = makeCache({ maxSize: 3 });
      c.put('gen', makeEntry({ chunkId: 'gen', state: 'generating' }));
      c.put('a', makeEntry({ chunkId: 'a' }));
      c.put('b', makeEntry({ chunkId: 'b' }));
      // evict(2): should skip 'gen' and evict 'a', 'b'
      const evicted = c.evict(2);
      expect(evicted).toEqual(['a', 'b']);
      expect(c.get('gen')).toBeDefined();
    });

    it('generating + evictable: evictable takes priority over generating', () => {
      const c = makeCache({ maxSize: 3 });
      c.put('gen', makeEntry({ chunkId: 'gen', state: 'generating' }));
      c.put('ev', makeEntry({ chunkId: 'ev', state: 'evictable' }));
      c.put('a', makeEntry({ chunkId: 'a' }));
      const evicted = c.evict(2);
      expect(evicted).toContain('ev');
      expect(evicted).toContain('a');
      expect(evicted).not.toContain('gen');
    });

    it('all entries generating: evict returns empty and removes nothing', () => {
      const c = makeCache({ maxSize: 3 });
      c.put('g1', makeEntry({ chunkId: 'g1', state: 'generating' }));
      c.put('g2', makeEntry({ chunkId: 'g2', state: 'generating' }));
      const evicted = c.evict(2);
      expect(evicted).toEqual([]);
      expect(c.getSize()).toBe(2);
    });
  });

  describe('dispose', () => {
    it('clears all entries', () => {
      const c = makeCache({ maxSize: 3 });
      c.put('a', makeEntry({ chunkId: 'a' }));
      c.put('b', makeEntry({ chunkId: 'b' }));
      c.dispose();
      expect(c.getSize()).toBe(0);
    });

    it('calls onEvict for all entries', () => {
      const onEvict = vi.fn();
      const c = makeCache({ maxSize: 3, onEvict });
      c.put('a', makeEntry({ chunkId: 'a' }));
      c.put('b', makeEntry({ chunkId: 'b' }));
      c.dispose();
      expect(onEvict).toHaveBeenCalledTimes(2);
    });

    it('get returns undefined after dispose', () => {
      const c = makeCache();
      c.put('k', makeEntry({ chunkId: 'k' }));
      c.dispose();
      expect(c.get('k')).toBeUndefined();
    });

    it('is idempotent', () => {
      const c = makeCache();
      c.put('a', makeEntry({ chunkId: 'a' }));
      c.dispose();
      expect(() => c.dispose()).not.toThrow();
      expect(c.getSize()).toBe(0);
    });
  });

  describe('stats', () => {
    it('getSize returns correct count', () => {
      const c = makeCache({ maxSize: 5 });
      expect(c.getSize()).toBe(0);
      c.put('a', makeEntry({ chunkId: 'a' }));
      expect(c.getSize()).toBe(1);
      c.put('b', makeEntry({ chunkId: 'b' }));
      expect(c.getSize()).toBe(2);
    });

    it('getSize decreases after evict', () => {
      const c = makeCache({ maxSize: 3 });
      c.put('a', makeEntry({ chunkId: 'a' }));
      c.put('b', makeEntry({ chunkId: 'b' }));
      c.evict(1);
      expect(c.getSize()).toBe(1);
    });

    it('getMaxSize returns configured value', () => {
      const c = makeCache({ maxSize: 42 });
      expect(c.getMaxSize()).toBe(42);
    });
  });

  describe('state transitions', () => {
    it('stores ready state', () => {
      const c = makeCache();
      c.put('k', makeEntry({ chunkId: 'k', state: 'ready' }));
      expect(c.get('k')!.state).toBe('ready');
    });

    it('stores generating state', () => {
      const c = makeCache();
      c.put('k', makeEntry({ chunkId: 'k', state: 'generating' }));
      expect(c.get('k')!.state).toBe('generating');
    });

    it('stores evictable state', () => {
      const c = makeCache();
      c.put('k', makeEntry({ chunkId: 'k', state: 'evictable' }));
      expect(c.get('k')!.state).toBe('evictable');
    });
  });
});
