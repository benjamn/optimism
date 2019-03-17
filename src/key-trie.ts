// A trie data structure that holds object keys weakly, yet can also hold
// non-object keys, unlike the native `WeakMap`.
export class KeyTrie<K> {
  // Since a `WeakMap` cannot hold primitive values as keys, we need a
  // backup `Map` instance to hold primitive keys. Both `this._weakMap`
  // and `this._strongMap` are lazily initialized.
  private weak?: WeakMap<any, KeyTrie<K>>;
  private strong?: Map<any, KeyTrie<K>>;
  private data?: K;

  constructor(private readonly weakness: boolean) {}

  public lookup<T extends any[]>(...array: T): K {
    return this.lookupArray(array);
  }

  public lookupArray<T extends any[]>(array: T): K {
    let node: KeyTrie<K> = this;
    array.forEach(key => node = node.getChildTrie(key));
    return node.data || (node.data = Object.create(null));
  }

  private getChildTrie(key: any) {
    const map = this.weakness && isObjRef(key)
      ? this.weak || (this.weak = new WeakMap<any, KeyTrie<K>>())
      : this.strong || (this.strong = new Map<any, KeyTrie<K>>());
    let child = map.get(key);
    if (!child) map.set(key, child = new KeyTrie<K>(this.weakness));
    return child;
  }
}

function isObjRef(value: any) {
  switch (typeof value) {
  case "object":
    if (value === null) break;
    // Fall through to return true...
  case "function":
    return true;
  }
  return false;
}
