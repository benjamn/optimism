import { Trie } from "@wry/trie";

import { Cache } from "./cache";
import { Entry, AnyEntry } from "./entry";
import { parentEntrySlot } from "./context";

// These helper functions are important for making optimism work with
// asynchronous code. In order to register parent-child dependencies,
// optimism needs to know about any currently active parent computations.
// In ordinary synchronous code, the parent context is implicit in the
// execution stack, but asynchronous code requires some extra guidance in
// order to propagate context from one async task segment to the next.
export {
  bindContext,
  noContext,
  setTimeout,
  asyncFromGen,
} from "./context";

// A lighter-weight dependency, similar to OptimisticWrapperFunction, except
// with only one argument, no makeCacheKey, no wrapped function to recompute,
// and no result value. Useful for representing dependency leaves in the graph
// of computation. Subscriptions are supported.
export { dep, OptimisticDependencyFunction } from "./dep";

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
const keyTrie = new Trie<TCacheKey>(typeof WeakMap === "function");
export function defaultMakeCacheKey(...args: any[]) {
  return keyTrie.lookupArray(args);
}

// If you're paranoid about memory leaks, or you want to avoid using WeakMap
// under the hood, but you still need the behavior of defaultMakeCacheKey,
// import this constructor to create your own tries.
export { Trie as KeyTrie }

export type OptimisticWrapperFunction<
  TArgs extends any[],
  TResult,
  TKeyArgs extends any[] = TArgs,
> = ((...args: TArgs) => TResult) & {
  // The .dirty(...) method of an optimistic function takes exactly the
  // same parameter types as the original function.
  dirty: (...args: TKeyArgs) => void;
  // Examine the current value without recomputing it.
  peek: (...args: TKeyArgs) => TResult | undefined;
  // Remove the entry from the cache, dirtying any parent entries.
  forget: (...args: TKeyArgs) => boolean;
  // Returns the key for the supplied arguments
  getKey: (...args: TArgs) => any;
  // Removes the entry from the cache using its key, dirtying any parent entries
  forgetKey: (key: any) => boolean;
};

export type OptimisticWrapOptions<
  TArgs extends any[],
  TKeyArgs extends any[] = TArgs,
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

const caches = new Set<Cache<TCacheKey, AnyEntry>>();

export function wrap<
  TArgs extends any[],
  TResult,
  TKeyArgs extends any[] = TArgs,
>(
  originalFunction: (...args: TArgs) => TResult,
  options: OptimisticWrapOptions<TArgs, TKeyArgs> = Object.create(null),
) {
  const cache = new Cache<TCacheKey, Entry<TArgs, TResult>>(
    options.max || Math.pow(2, 16),
    entry => entry.dispose(),
  );

  const keyArgs = options.keyArgs;
  const makeCacheKey = options.makeCacheKey || defaultMakeCacheKey;

  function optimistic(): TResult {
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
      entry.subscribe = options.subscribe;
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
  }

  function lookup(): Entry<TArgs, TResult> | undefined {
    const key = makeCacheKey.apply(null, arguments as any);
    if (key !== void 0) {
      return cache.get(key);
    }
  }

  optimistic.dirty = function () {
    const entry = lookup.apply(null, arguments as any);
    if (entry) {
      entry.setDirty();
    }
  };

  optimistic.peek = function () {
    const entry = lookup.apply(null, arguments as any);
    if (entry) {
      return entry.peek();
    }
  };

  optimistic.forget = function () {
    const key = makeCacheKey.apply(null, arguments as any);
    return key !== void 0 && cache.delete(key);
  };

  optimistic.getKey = function () {
    const key = makeCacheKey.apply(
        null,
        keyArgs ? keyArgs.apply(null, arguments as any) : arguments as any
      );
    return key;
  };

  optimistic.forgetKey = function (key: any) {
    return key !== void 0 && cache.delete(key);
  };

  return optimistic as OptimisticWrapperFunction<TArgs, TResult, TKeyArgs>;
}
