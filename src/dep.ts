import { AnyEntry } from "./entry";
import { OptimisticWrapOptions } from "./index";
import { parentEntrySlot } from "./context";
import { Unsubscribable, maybeUnsubscribe } from "./helpers";

export type OptimisticDependencyFunction<TKey> =
  ((key: TKey) => void) & {
    dirty: (key: TKey) => void;
  };

export type Dep<TKey> = Set<AnyEntry> & {
  subscribe: OptimisticWrapOptions<[TKey]>["subscribe"];
} & Unsubscribable;

export function dep<TKey>(options?: {
  subscribe: Dep<TKey>["subscribe"];
}) {
  const depsByKey = new Map<TKey, Dep<TKey>>();
  const subscribe = options && options.subscribe;

  function depend(key: TKey) {
    const parent = parentEntrySlot.getValue();
    if (parent) {
      let dep = depsByKey.get(key);
      if (!dep) {
        depsByKey.set(key, dep = new Set as Dep<TKey>);
      }
      parent.dependOn(dep);
      if (typeof subscribe === "function") {
        maybeUnsubscribe(dep);
        dep.unsubscribe = subscribe(key);
      }
    }
  }

  depend.dirty = function dirty(key: TKey) {
    const dep = depsByKey.get(key);
    if (dep) {
      dep.forEach(entry => entry.setDirty());
      depsByKey.delete(key);
      maybeUnsubscribe(dep);
    }
  };

  return depend as OptimisticDependencyFunction<TKey>;
}
