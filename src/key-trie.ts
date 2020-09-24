// A trie data structure that holds object keys weakly, yet can also hold
// non-object keys, unlike the native `WeakMap`.

// If no makeData function is supplied, the looked-up data will be an empty,
// no-prototype Object.
const defaultMakeData = () => Object.create(null);

// Useful for processing arguments objects as well as arrays.
const { forEach, slice } = Array.prototype;

export class KeyTrie<K> {
  // Since a `WeakMap` cannot hold primitive values as keys, we need a
  // backup `Map` instance to hold primitive keys. Both `this._weakMap`
  // and `this._strongMap` are lazily initialized.
  private weak?: WeakMap<any, KeyTrie<K>>;
  private strong?: Map<any, KeyTrie<K>>;
  private data?: K;

  constructor(
    private weakness: boolean,
    private makeData: (array: any[]) => K = defaultMakeData,
  ) {}

  public lookup<T extends any[]>(...array: T): K {
    return this.lookupArray(array);
  }

  public lookupArray<T extends IArguments | any[]>(array: T): K {
    let node: KeyTrie<K> = this;
    forEach.call(array, key => node = node.getChildTrie(key));
    return node.data || (node.data = this.makeData(slice.call(array)));
  }

  private getChildTrie(key: any) {
    const map = this.weakness && isObjRef(key)
      ? this.weak || (this.weak = new WeakMap<any, KeyTrie<K>>())
      : this.strong || (this.strong = new Map<any, KeyTrie<K>>());
    let child = map.get(key);
    if (!child) map.set(key, child = new KeyTrie<K>(this.weakness, this.makeData));
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
