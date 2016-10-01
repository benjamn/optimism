import LRU from "lru-cache";
import { Entry } from "./entry.js";

function defaultMakeCacheKey(...args) {
  return JSON.stringify(args);
}

export function makeOptimistic(fn, options) {
  options = options || Object.create(null);
  if (typeof options.makeCacheKey !== "function") {
    options.makeCacheKey = defaultMakeCacheKey;
  }

  const cache = new LRU({
    dispose(entry, key) {
      // TODO
    }
  });

  function optimistic(...args) {
    const key = options.makeCacheKey(...args);
    if (! key) {
      return fn(...args);
    }

    let entry = cache.get(key);
    if (entry) {
      entry.args = args;
    } else {
      cache.set(key, entry = new Entry(fn, key, args));
    }

    return entry.recomputeIfDirty();
  }

  optimistic.dirty = function (...args) {
    const key = options.makeCacheKey(...args);
    if (! key) {
      return;
    }

    if (! cache.has(key)) {
      return;
    }

    cache.get(key).setDirty();
  };

  return optimistic;
}
