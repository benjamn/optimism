interface Node<K, V> {
  key: K;
  value: V;
  newer: Node<K, V> | null;
  older: Node<K, V> | null;
}

function defaultDispose() {}

export class Cache<K = any, V = any> {
  private map = new Map<K, Node<K, V>>();
  private newest: Node<K, V> | null = null;
  private oldest: Node<K, V> | null = null;

  constructor(
    private max = Infinity,
    public dispose: (value: V, key: K) => void = defaultDispose,
  ) {}

  public has(key: K): boolean {
    return this.map.has(key);
  }

  public get(key: K): V | undefined {
    const entry = this.getEntry(key);
    return entry && entry.value;
  }

  private getEntry(key: K): Node<K, V> | undefined {
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
      entry.older!.newer = entry;

      entry.newer = null;
      this.newest = entry;

      if (entry === this.oldest) {
        this.oldest = newer;
      }
    }

    return entry;
  }

  public set(key: K, value: V): V {
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

  public clean() {
    while (this.oldest && this.map.size > this.max) {
      this.delete(this.oldest.key);
    }
  }

  public delete(key: K): boolean {
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
      this.dispose(entry.value, key);

      return true;
    }

    return false;
  }
}
