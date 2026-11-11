export class Pools {
  constructor({maxLive, maxPerFrame, limits = {}}) {
    this.maxLive = maxLive;
    this.maxPerFrame = maxPerFrame;
    this.limits = limits;
    this.pools = new Map();
    this.live = new Map();
    this.acquisitions = 0;
  }

  register(key, {size, create, reset, dispose, group}) {
    if (this.pools.has(key)) return;
    const items = Array.from({length: size}, create);
    this.pools.set(key, {items, free: items.slice(), reset, dispose, group});
  }

  beginFrame() {
    this.acquisitions = 0;
  }

  acquire(key) {
    const pool = this.pools.get(key);
    if (!pool || this.acquisitions >= this.maxPerFrame) return null;
    if (!pool.free.length) this.recycle(entry => entry === pool);
    const limit = this.limits[pool.group];
    if (limit && this.count(pool.group) >= limit) this.recycle(entry => entry.group === pool.group);
    // Give up a short-lived effect before a clone, summon or projectile: those
    // are gameplay objects, and recycling one makes it vanish mid-life.
    if (this.live.size >= this.maxLive && !this.recycle(entry => entry.group === undefined)) {
      this.recycle(() => true);
    }
    const item = pool.free.pop();
    if (!item) return null;
    this.live.set(item, pool);
    this.acquisitions++;
    return item;
  }

  count(group) {
    let count = 0;
    for (const pool of this.live.values()) if (pool.group === group) count++;
    return count;
  }

  recycle(matches) {
    for (const [item, pool] of this.live) {
      if (matches(pool)) {
        this.recycleItem(item, pool);
        return true;
      }
    }
    return false;
  }

  release(key, item) {
    const pool = this.pools.get(key);
    if (pool && this.live.get(item) === pool) this.recycleItem(item, pool);
  }

  recycleItem(item, pool) {
    this.live.delete(item);
    pool.reset(item);
    pool.free.push(item);
  }

  dispose() {
    for (const pool of this.pools.values()) for (const item of pool.items) pool.dispose(item);
    this.live.clear();
    this.pools.clear();
  }
}
