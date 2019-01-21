interface Entry<K, V> {
  key: K;
  value: V;
  newer: Entry<K, V> | null;
  older: Entry<K, V> | null;
}

export class Cache<K = any, V = any> {
  private map = new Map<K, Entry<K, V>>();
  private newest: Entry<K, V> | null = null;
  private oldest: Entry<K, V> | null = null;
  private max: number = Infinity;

  constructor(options: {
    max?: number;
    dispose?: (key: K, value: V) => void;
  } = {}) {
    if (typeof options.max === "number") {
      this.max = options.max;
    }
    if (typeof options.dispose === "function") {
      this.dispose = options.dispose;
    }
  }

  has(key: K) {
    return this.map.has(key);
  }

  get(key: K) {
    const entry = this.getEntry(key);
    return entry && entry.value;
  }

  private getEntry(key: K): Entry<K, V> | void {
    const entry = this.map.get(key);

    if (entry && entry !== this.newest) {
      const { older, newer } = entry;

      if (newer) {
        newer.older = older;
      }

      if (older) {
        older.newer = newer;
      }

      entry.older = this.newest;
      (entry.older as Entry<K, V>).newer = entry;

      entry.newer = null;
      this.newest = entry;

      if (entry === this.oldest) {
        this.oldest = newer;
      }
    }

    return entry;
  }

  set(key: K, value: V) {
    let entry = this.getEntry(key);
    if (entry) {
      return entry.value = value;
    }

    entry = {
      key: key,
      value: value,
      newer: null,
      older: this.newest
    };

    if (this.newest) {
      this.newest.newer = entry;
    }

    this.newest = entry;
    this.oldest = this.oldest || entry;

    this.map.set(key, entry);

    return entry.value;
  }

  clean() {
    while (this.oldest && this.map.size > this.max) {
      this.delete(this.oldest.key);
    }
  }

  delete(key: K) {
    const entry = this.map.get(key);
    if (entry) {
      if (entry === this.newest) {
        this.newest = entry.older;
      }

      if (entry === this.oldest) {
        this.oldest = entry.newer;
      }

      if (entry.newer) {
        entry.newer.older = entry.older;
      }

      if (entry.older) {
        entry.older.newer = entry.newer;
      }

      this.map.delete(key);
      this.dispose(key, entry.value);

      return true;
    }

    return false;
  }

  dispose(key: K, value: V) {}
}
