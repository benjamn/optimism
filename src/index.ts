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

function makeDefaultMakeCacheKeyFunction<
  TKeyArgs extends any[],
  TCacheKey = any,
>(): (...args: TKeyArgs) => TCacheKey {
  const keyTrie = new Trie<TCacheKey>(typeof WeakMap === "function");
  return function () {
    return keyTrie.lookupArray(arguments);
  };
}

// The defaultMakeCacheKey function is remarkably powerful, because it gives
// a unique object for any shallow-identical list of arguments. If you need
// to implement a custom makeCacheKey function, you may find it helpful to
// delegate the final work to defaultMakeCacheKey, which is why we export it
// here. However, you may want to avoid defaultMakeCacheKey if your runtime
// does not support WeakMap, or you have the ability to return a string key.
// In those cases, just write your own custom makeCacheKey functions.
export const defaultMakeCacheKey = makeDefaultMakeCacheKeyFunction();

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
  // If true, keys returned by makeCacheKey will be deleted from the LRU cache
  // when they become unreachable. Defaults to true when WeakMap, WeakRef, and
  // FinalizationRegistry are available. Otherwise always false.
  useWeakKeys?: boolean,
};

const canUseWeakKeys =
  typeof WeakMap === "function" &&
  typeof WeakRef === "function" &&
  typeof FinalizationRegistry === "function";

const caches = new Set<Cache<any, AnyEntry>>();

export function wrap<
  TArgs extends any[],
  TResult,
  TKeyArgs extends any[] = TArgs,
  TCacheKey = any,
>(
  originalFunction: (...args: TArgs) => TResult,
  options: OptimisticWrapOptions<TArgs, TKeyArgs> = Object.create(null),
) {
  const cache = new Cache<TCacheKey, Entry<TArgs, TResult>>(
    options.max || Math.pow(2, 16),
    entry => entry.dispose(),
  );

  const keyArgs = options.keyArgs;
  const makeCacheKey = options.makeCacheKey ||
    makeDefaultMakeCacheKeyFunction<TKeyArgs, TCacheKey>();

    // If options.useWeakKeys is true but canUseWeakKeys is false, the
  // useWeakKeys variable must be false, since the FinalizationRegistry
  // cannot be simulated or polyfilled.
  const useWeakKeys = options.useWeakKeys === void 0
    ? canUseWeakKeys
    : canUseWeakKeys && !!options.useWeakKeys;

  // Optional WeakMap mapping object keys returned by makeCacheKey to
  // empty object references that will be stored in the cache instead of
  // the original key object. Undefined/unused if useWeakKeys is false.
  // It's tempting to use WeakRef objects instead of empty objects, but
  // we never actually need to call .deref(), and using WeakRef here
  // noticeably slows down cache performance.
  const weakRefs = useWeakKeys
    ? new WeakMap<object, {}>()
    : void 0;

  // Optional registry allowing empty key references to be deleted from
  // the cache after the original key objects become unreachable.
  const registry = useWeakKeys
    ? new FinalizationRegistry(ref => cache.delete(ref))
    : void 0;

  // Wrapper for makeCacheKey that promotes object keys to empty reference
  // objects, allowing the original key objects to be reclaimed by the
  // garbage collector, which triggers the deletion of the references from
  // the cache, using the registry, when useWeakKeys is true. Non-object
  // keys returned by makeCacheKey (e.g. strings) are preserved.
  function makeKey(keyArgs: IArguments | TKeyArgs) {
    let key = makeCacheKey.apply(null, keyArgs as TKeyArgs);
    if (useWeakKeys && key && typeof key === "object") {
      let ref = weakRefs!.get(key)!;
      if (!ref) {
        weakRefs!.set(key, ref = {});
        registry!.register(key, ref);
      }
      key = ref;
    }
    return key;
  }

  const optimistic = function (): TResult {
    const key = makeKey(
      keyArgs ? keyArgs.apply(null, arguments as any) : arguments
    );

    if (key === void 0) {
      return originalFunction.apply(null, arguments as any);
    }

    let entry = cache.get(key)!;
    if (!entry) {
      cache.set(key, entry = new Entry(originalFunction));
      entry.subscribe = options.subscribe;
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

  function dirtyKey(key: TCacheKey) {
    const entry = cache.get(key);
    if (entry) {
      entry.setDirty();
    }
  }
  optimistic.dirtyKey = dirtyKey;
  optimistic.dirty = function dirty() {
    dirtyKey(makeKey(arguments));
  };

  function peekKey(key: TCacheKey) {
    const entry = cache.get(key);
    if (entry) {
      return entry.peek();
    }
  }
  optimistic.peekKey = peekKey;
  optimistic.peek = function peek() {
    return peekKey(makeKey(arguments));
  };

  function forgetKey(key: TCacheKey) {
    return cache.delete(key);
  }
  optimistic.forgetKey = forgetKey;
  optimistic.forget = function forget() {
    return forgetKey(makeKey(arguments));
  };

  optimistic.makeCacheKey = makeCacheKey;
  optimistic.getKey = keyArgs ? function getKey() {
    return makeKey(keyArgs.apply(null, arguments as any));
  } : function getKey() {
    return makeKey(arguments);
  };

  return Object.freeze(optimistic);
}
