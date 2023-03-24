import { Trie } from "@wry/trie";

import { Cache } from "./cache.js";
import { Entry, AnyEntry } from "./entry.js";
import { parentEntrySlot } from "./context.js";

// These helper functions are important for making optimism work with
// asynchronous code. In order to register parent-child dependencies,
// optimism needs to know about any currently active parent computations.
// In ordinary synchronous code, the parent context is implicit in the
// execution stack, but asynchronous code requires some extra guidance in
// order to propagate context from one async task segment to the next.
export {
  bindContext,
  noContext,
  nonReactive,
  setTimeout,
  asyncFromGen,
} from "./context.js";

// A lighter-weight dependency, similar to OptimisticWrapperFunction, except
// with only one argument, no makeCacheKey, no wrapped function to recompute,
// and no result value. Useful for representing dependency leaves in the graph
// of computation. Subscriptions are supported.
export { dep, OptimisticDependencyFunction } from "./dep.js";

// The defaultMakeCacheKey function is remarkably powerful, because it gives
// a unique object for any shallow-identical list of arguments. If you need
// to implement a custom makeCacheKey function, you may find it helpful to
// delegate the final work to defaultMakeCacheKey, which is why we export it
// here. However, you may want to avoid defaultMakeCacheKey if your runtime
// does not support WeakMap, or you have the ability to return a string key.
// In those cases, just write your own custom makeCacheKey functions.
let defaultKeyTrie: Trie<object> | undefined;
export function defaultMakeCacheKey(...args: any[]): object {
  const trie = defaultKeyTrie || (
    defaultKeyTrie = new Trie(typeof WeakMap === "function")
  );
  return trie.lookupArray(args);
}

// If you're paranoid about memory leaks, or you want to avoid using WeakMap
// under the hood, but you still need the behavior of defaultMakeCacheKey,
// import this constructor to create your own tries.
export { Trie as KeyTrie }

export type OptimisticWrapperFunction<
  TArgs extends any[],
  TResult,
  TKeyArgs extends any[] = TArgs,
  TCacheKey = any,
> = ((...args: TArgs) => TResult) & {
  // Get the current number of Entry objects in the LRU cache.
  readonly size: number;

  // Snapshot of wrap options used to create this wrapper function.
  options: OptimisticWrapOptions<TArgs, TKeyArgs, TCacheKey>;

  // "Dirty" any cached Entry stored for the given arguments, marking that Entry
  // and its ancestors as potentially needing to be recomputed. The .dirty(...)
  // method of an optimistic function takes the same parameter types as the
  // original function by default, unless a keyArgs function is configured, and
  // then it matters that .dirty takes TKeyArgs instead of TArgs.
  dirty: (...args: TKeyArgs) => void;
  // A version of .dirty that accepts a key returned by .getKey.
  dirtyKey: (key: TCacheKey) => void;

  // Examine the current value without recomputing it.
  peek: (...args: TKeyArgs) => TResult | undefined;
  // A version of .peek that accepts a key returned by .getKey.
  peekKey: (key: TCacheKey) => TResult | undefined;

  // Completely remove the entry from the cache, dirtying any parent entries.
  forget: (...args: TKeyArgs) => boolean;
  // A version of .forget that accepts a key returned by .getKey.
  forgetKey: (key: TCacheKey) => boolean;

  // In order to use the -Key version of the above functions, you need a key
  // rather than the arguments used to compute the key. These two functions take
  // TArgs or TKeyArgs and return the corresponding TCacheKey. If no keyArgs
  // function has been configured, TArgs will be the same as TKeyArgs, and thus
  // getKey and makeCacheKey will be synonymous.
  getKey: (...args: TArgs) => TCacheKey;

  // This property is equivalent to the makeCacheKey function provided in the
  // OptimisticWrapOptions, or (if no options.makeCacheKey function is provided)
  // a default implementation of makeCacheKey.
  makeCacheKey: (...args: TKeyArgs) => TCacheKey;
};

export type OptimisticWrapOptions<
  TArgs extends any[],
  TKeyArgs extends any[] = TArgs,
  TCacheKey = any,
> = {
  // The maximum number of cache entries that should be retained before the
  // cache begins evicting the oldest ones.
  max?: number;
  // Transform the raw arguments to some other type of array, which will then
  // be passed to makeCacheKey.
  keyArgs?: (...args: TArgs) => TKeyArgs;
  // The makeCacheKey function takes the same arguments that were passed to
  // the wrapper function and returns a single value that can be used as a key
  // in a Map to identify the cached result.
  makeCacheKey?: (...args: TKeyArgs) => TCacheKey;
  // If provided, the subscribe function should either return an unsubscribe
  // function or return nothing.
  subscribe?: (...args: TArgs) => void | (() => any);
};

const caches = new Set<Cache<any, AnyEntry>>();

export function wrap<
  TArgs extends any[],
  TResult,
  TKeyArgs extends any[] = TArgs,
  TCacheKey = any,
>(originalFunction: (...args: TArgs) => TResult, {
  max = Math.pow(2, 16),
  makeCacheKey = defaultMakeCacheKey,
  keyArgs,
  subscribe,
}: OptimisticWrapOptions<TArgs, TKeyArgs> = Object.create(null)) {
  const cache = new Cache<TCacheKey, Entry<TArgs, TResult>>(
    max,
    entry => entry.dispose(),
  );

  const optimistic = function (): TResult {
    const key = makeCacheKey.apply(
      null,
      keyArgs ? keyArgs.apply(null, arguments as any) : arguments as any
    );

    if (key === void 0) {
      return originalFunction.apply(null, arguments as any);
    }

    let entry = cache.get(key)!;
    if (!entry) {
      cache.set(key, entry = new Entry(originalFunction));
      entry.subscribe = subscribe;
      // Give the Entry the ability to trigger cache.delete(key), even though
      // the Entry itself does not know about key or cache.
      entry.forget = () => cache.delete(key);
    }

    const value = entry.recompute(
      Array.prototype.slice.call(arguments) as TArgs,
    );

    // Move this entry to the front of the least-recently used queue,
    // since we just finished computing its value.
    cache.set(key, entry);

    caches.add(cache);

    // Clean up any excess entries in the cache, but only if there is no
    // active parent entry, meaning we're not in the middle of a larger
    // computation that might be flummoxed by the cleaning.
    if (! parentEntrySlot.hasValue()) {
      caches.forEach(cache => cache.clean());
      caches.clear();
    }

    return value;
  } as OptimisticWrapperFunction<TArgs, TResult, TKeyArgs, TCacheKey>;

  Object.defineProperty(optimistic, "size", {
    get() {
      return cache["map"].size;
    },
    configurable: false,
    enumerable: false,
  });

  Object.freeze(optimistic.options = {
    max,
    makeCacheKey,
    keyArgs,
    subscribe,
  });

  function dirtyKey(key: TCacheKey) {
    const entry = cache.get(key);
    if (entry) {
      entry.setDirty();
    }
  }
  optimistic.dirtyKey = dirtyKey;
  optimistic.dirty = function dirty() {
    dirtyKey(makeCacheKey.apply(null, arguments as any));
  };

  function peekKey(key: TCacheKey) {
    const entry = cache.get(key);
    if (entry) {
      return entry.peek();
    }
  }
  optimistic.peekKey = peekKey;
  optimistic.peek = function peek() {
    return peekKey(makeCacheKey.apply(null, arguments as any));
  };

  function forgetKey(key: TCacheKey) {
    return cache.delete(key);
  }
  optimistic.forgetKey = forgetKey;
  optimistic.forget = function forget() {
    return forgetKey(makeCacheKey.apply(null, arguments as any));
  };

  optimistic.makeCacheKey = makeCacheKey;
  optimistic.getKey = keyArgs ? function getKey() {
    return makeCacheKey.apply(null, keyArgs.apply(null, arguments as any));
  } : makeCacheKey as (...args: any[]) => TCacheKey;

  return Object.freeze(optimistic);
}
