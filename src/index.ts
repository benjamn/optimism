import { Cache } from "./cache";
import { Entry } from "./entry";
import { get as getLocal } from "./local";

type AnyFn = (...args: any[]) => any;

// Exported so that custom makeCacheKey functions can easily reuse the
// default implementation (with different arguments).
export const defaultMakeCacheKey: AnyFn =
  require("immutable-tuple").tuple;

export type OptimisticWrapperFunction<T extends AnyFn> = T & {
  // The .dirty(...) method of an optimistic function takes exactly the
  // same parameter types as the original function.
  dirty: T;
};

export type OptimisticWrapOptions = {
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
  makeCacheKey?: AnyFn;
  // If provided, the subscribe function should either return an unsubscribe
  // function or return nothing.
  subscribe?: (...args: any[]) => (() => any) | undefined;
};

export function wrap<T extends AnyFn>(originalFunction: T, {
  max = Math.pow(2, 16),
  disposable = false,
  makeCacheKey = defaultMakeCacheKey,
  subscribe,
}: OptimisticWrapOptions = Object.create(null)) {
  const cache = new Cache<object, Entry>({
    max,
    dispose(entry) {
      entry.dispose();
    },
  });

  function reportOrphan(entry: Entry) {
    // Triggers the entry.dispose() call above.
    return disposable && cache.delete(entry.key);
  }

  function optimistic(...args: any[]): any {
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
      cache.set(key, entry = Entry.acquire(originalFunction, key, args));
      entry.subscribe = subscribe;
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

  optimistic.dirty = function (...args: any[]) {
    const key = makeCacheKey.apply(null, args);
    if (key && cache.has(key)) {
      (cache.get(key) as Entry).setDirty();
    }
  };

  return optimistic as OptimisticWrapperFunction<T>;
}
