import { Cache } from "./cache";
import { Entry } from "./entry";
import { get as getLocal } from "./local";
import { KeyTrie } from "./key-trie";

// Since the Cache uses a Map internally, any value or object reference can
// be safely used as a key, though common types include object and string.
export type TCacheKey = any;

// The defaultMakeCacheKey function is remarkably powerful, because it gives
// a unique object for any shallow-identical list of arguments. If you need
// to implement a custom makeCacheKey function, you may find it helpful to
// delegate the final work to defaultMakeCacheKey, which is why we export it
// here. However, you may want to avoid defaultMakeCacheKey if your runtime
// does not support WeakMap, or you have the ability to return a string key.
// In those cases, just write your own custom makeCacheKey functions.
const keyTrie = new KeyTrie<TCacheKey>();
export function defaultMakeCacheKey(...args: any[]) {
  return keyTrie.lookup(args);
}

export type OptimisticWrapperFunction<
  TArgs extends any[],
  TResult,
> = ((...args: TArgs) => TResult) & {
  // The .dirty(...) method of an optimistic function takes exactly the
  // same parameter types as the original function.
  dirty: (...args: TArgs) => void;
};

export type OptimisticWrapOptions<TArgs extends any[]> = {
  // The maximum number of cache entries that should be retained before the
  // cache begins evicting the oldest ones.
  max?: number;
  // If a wrapped function is "disposable," then its creator does not
  // care about its return value, and it should be removed from the cache
  // immediately when it no longer has any parents that depend on it.
  disposable?: boolean;
  // The makeCacheKey function takes the same arguments that were passed to
  // the wrapper function and returns a single value that can be used as a key
  // in a Map to identify the cached result.
  makeCacheKey?: (...args: TArgs) => TCacheKey;
  // If provided, the subscribe function should either return an unsubscribe
  // function or return nothing.
  subscribe?: (...args: TArgs) => (() => any) | undefined;
};

export function wrap<
  TArgs extends any[],
  TResult,
>(
  originalFunction: (...args: TArgs) => TResult,
  options: OptimisticWrapOptions<TArgs> = Object.create(null),
) {
  const cache = new Cache<TCacheKey, Entry<TArgs, TResult, TCacheKey>>(
    options.max || Math.pow(2, 16),
    entry => entry.dispose(),
  );

  const disposable = !! options.disposable;
  const makeCacheKey = options.makeCacheKey || defaultMakeCacheKey;

  function reportOrphan(entry: Entry<TArgs, TResult, TCacheKey>) {
    // Triggers the entry.dispose() call above.
    return disposable && cache.delete(entry.key);
  }

  function optimistic(...args: TArgs): TResult | undefined {
    if (disposable && ! getLocal().currentParentEntry) {
      // If there's no current parent computation, and this wrapped
      // function is disposable (meaning we don't care about entry.value,
      // just dependency tracking), then we can short-cut everything else
      // in this function, because entry.recompute() is going to recycle
      // the entry object without recomputing anything, anyway.
      return;
    }

    const key = makeCacheKey.apply(null, args);
    if (! key) {
      return originalFunction.apply(null, args);
    }

    let entry = cache.get(key);
    if (entry) {
      entry.args = args;
    } else {
      entry = new Entry<TArgs, TResult, TCacheKey>(originalFunction, args, key);
      cache.set(key, entry);
      entry.subscribe = options.subscribe;
      if (disposable) {
        entry.reportOrphan = reportOrphan;
      }
    }

    const value = entry.recompute();

    // Move this entry to the front of the least-recently used queue,
    // since we just finished computing its value.
    cache.set(key, entry);

    // Clean up any excess entries in the cache, but only if this entry
    // has no parents, which means we're not in the middle of a larger
    // computation that might be flummoxed by the cleaning.
    if (entry.isOrphan()) {
      cache.clean();
    }

    // If options.disposable is truthy, the caller of wrap is telling us
    // they don't care about the result of entry.recompute(), so we should
    // avoid returning the value, so it won't be accidentally used.
    if (! disposable) {
      return value;
    }
  }

  optimistic.dirty = function (...args: TArgs) {
    const key = makeCacheKey.apply(null, args);
    const child = key && cache.get(key);
    if (child) {
      child.setDirty();
    }
  };

  return optimistic as OptimisticWrapperFunction<TArgs, TResult>;
}
