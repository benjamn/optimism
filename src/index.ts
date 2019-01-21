import { Cache } from "./cache";
import { Entry } from "./entry";
import { get as getLocal } from "./local";

// Exported so that custom makeCacheKey functions can easily reuse the
// default implementation (with different arguments).
export const defaultMakeCacheKey: (...args: any[]) => any =
  require("immutable-tuple").tuple;

export function wrap<T extends (...args: any[]) => any>(fn: T, {
  max = Math.pow(2, 16),
  makeCacheKey = defaultMakeCacheKey,
  // If this wrapped function is disposable, then its creator does not
  // care about its return value, and it should be removed from the cache
  // immediately when it no longer has any parents that depend on it.
  disposable = false,
  subscribe = null,
} = Object.create(null)) {
  const cache = new Cache<object, Entry>({
    max,
    dispose(_key, entry) {
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
      return fn.apply(null, args);
    }

    let entry = cache.get(key);
    if (entry) {
      entry.args = args;
    } else {
      cache.set(key, entry = Entry.acquire(fn, key, args));
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

  return optimistic as T & { dirty: T };
}
