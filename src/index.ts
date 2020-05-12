import { Cache } from "./cache";
import { Entry, AnyEntry } from "./entry";
import { parentEntrySlot } from "./context";
import { KeyTrie } from "./key-trie";

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
const keyTrie = new KeyTrie<TCacheKey>(typeof WeakMap === "function");
export function defaultMakeCacheKey(...args: any[]) {
  return keyTrie.lookupArray(args);
}

// If you're paranoid about memory leaks, or you want to avoid using WeakMap
// under the hood, but you still need the behavior of defaultMakeCacheKey,
// import this constructor to create your own tries.
export { KeyTrie }

export type OptimisticWrapperFunction<
  TArgs extends any[],
  TResult,
  TKeyArgs extends any[] = TArgs,
> = ((...args: TArgs) => TResult) & {
  // The .dirty(...) method of an optimistic function takes exactly the
  // same parameter types as the original function.
  dirty: (...args: TKeyArgs) => void;
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

  const keyArgs = options.keyArgs || ((...args: TArgs): TKeyArgs => args as any);
  const makeCacheKey = options.makeCacheKey || defaultMakeCacheKey;

  function optimistic(): TResult {
    const key = makeCacheKey.apply(null, keyArgs.apply(null, arguments as any));
    if (key === void 0) {
      return originalFunction.apply(null, arguments as any);
    }

    const args = Array.prototype.slice.call(arguments) as TArgs;

    let entry = cache.get(key);
    if (entry) {
      entry.args = args;
    } else {
      entry = new Entry<TArgs, TResult>(originalFunction, args);
      cache.set(key, entry);
      entry.subscribe = options.subscribe;
    }

    const value = entry.recompute();

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

  optimistic.dirty = function () {
    const key = makeCacheKey.apply(null, keyArgs.apply(null, arguments as any));
    const child = key !== void 0 && cache.get(key);
    if (child) {
      child.setDirty();
    }
  };

  return optimistic as OptimisticWrapperFunction<TArgs, TResult, TKeyArgs>;
}
