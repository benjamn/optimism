import { parentEntrySlot } from "./context";
import { OptimisticWrapOptions } from "./index";

const reusableEmptyArray: AnyEntry[] = [];
const emptySetPool: Set<AnyEntry>[] = [];
const POOL_TARGET_SIZE = 100;

// Since this package might be used browsers, we should avoid using the
// Node built-in assert module.
function assert(condition: any, optionalMessage?: string) {
  if (! condition) {
    throw new Error(optionalMessage || "assertion failure");
  }
}

// Since exceptions are cached just like normal values, we need an efficient
// way of representing unknown, ordinary, and exceptional values.
type Value<T> =
  | []           // unknown
  | [T]          // known value
  | [void, any]; // known exception

function valueIs(a: Value<any>, b: Value<any>) {
  const len = a.length;
  return (
    // Unknown values are not equal to each other.
    len > 0 &&
    // Both values must be ordinary (or both exceptional) to be equal.
    len === b.length &&
    // The underlying value or exception must be the same.
    a[len - 1] === b[len - 1]
  );
}

function valueGet<T>(value: Value<T>): T {
  switch (value.length) {
    case 0: throw new Error("unknown value");
    case 1: return value[0];
    case 2: throw value[1];
  }
}

function valueCopy<T>(value: Value<T>): Value<T> {
  return value.slice(0) as Value<T>;
}

export type AnyEntry = Entry<any, any>;

export class Entry<TArgs extends any[], TValue> {
  public static count = 0;

  public subscribe: OptimisticWrapOptions<TArgs>["subscribe"];
  public unsubscribe?: () => any;
  public reportOrphan?: (this: Entry<TArgs, TValue>) => any;

  public readonly parents = new Set<AnyEntry>();
  public readonly childValues = new Map<AnyEntry, Value<any>>();

  // When this Entry has children that are dirty, this property becomes
  // a Set containing other Entry objects, borrowed from emptySetPool.
  // When the set becomes empty, it gets recycled back to emptySetPool.
  public dirtyChildren: Set<AnyEntry> | null = null;

  public dirty = true;
  public recomputing = false;
  public readonly value: Value<TValue> = [];

  constructor(
    public readonly fn: (...args: TArgs) => TValue,
    public args: TArgs,
  ) {
    ++Entry.count;
  }

  // This is the most important method of the Entry API, because it
  // determines whether the cached this.value can be returned immediately,
  // or must be recomputed. The overall performance of the caching system
  // depends on the truth of the following observations: (1) this.dirty is
  // usually false, (2) this.dirtyChildren is usually null/empty, and thus
  // (3) valueGet(this.value) is usually returned without recomputation.
  public recompute(): TValue {
    assert(! this.recomputing, "already recomputing");

    if (! rememberParent(this) && maybeReportOrphan(this)) {
      // The recipient of the entry.reportOrphan callback decided to dispose
      // of this orphan entry by calling entry.dispose(), so we don't need to
      // (and should not) proceed with the recomputation.
      return void 0 as any;
    }

    return mightBeDirty(this)
      ? reallyRecompute(this)
      : valueGet(this.value);
  }

  public setDirty() {
    if (this.dirty) return;
    this.dirty = true;
    this.value.length = 0;
    reportDirty(this);
    // We can go ahead and unsubscribe here, since any further dirty
    // notifications we receive will be redundant, and unsubscribing may
    // free up some resources, e.g. file watchers.
    maybeUnsubscribe(this);
  }

  public dispose() {
    forgetChildren(this).forEach(maybeReportOrphan);
    maybeUnsubscribe(this);

    // Because this entry has been kicked out of the cache (in index.js),
    // we've lost the ability to find out if/when this entry becomes dirty,
    // whether that happens through a subscription, because of a direct call
    // to entry.setDirty(), or because one of its children becomes dirty.
    // Because of this loss of future information, we have to assume the
    // worst (that this entry might have become dirty very soon), so we must
    // immediately mark this entry's parents as dirty. Normally we could
    // just call entry.setDirty() rather than calling parent.setDirty() for
    // each parent, but that would leave this entry in parent.childValues
    // and parent.dirtyChildren, which would prevent the child from being
    // truly forgotten.
    this.parents.forEach(parent => {
      parent.setDirty();
      forgetChild(parent, this);
    });
  }
}

function rememberParent(child: AnyEntry) {
  const parent = parentEntrySlot.getValue();
  if (parent) {
    child.parents.add(parent);

    if (! parent.childValues.has(child)) {
      parent.childValues.set(child, []);
    }

    if (mightBeDirty(child)) {
      reportDirtyChild(parent, child);
    } else {
      reportCleanChild(parent, child);
    }

    return parent;
  }
}

function reallyRecompute(entry: AnyEntry) {
  // Since this recomputation is likely to re-remember some of this
  // entry's children, we forget our children here but do not call
  // maybeReportOrphan until after the recomputation finishes.
  const originalChildren = forgetChildren(entry);

  // Set entry as the parent entry while calling recomputeNewValue(entry).
  parentEntrySlot.withValue(entry, recomputeNewValue, [entry]);

  if (maybeSubscribe(entry)) {
    // If we successfully recomputed entry.value and did not fail to
    // (re)subscribe, then this Entry is no longer explicitly dirty.
    setClean(entry);
  }

  // Now that we've had a chance to re-remember any children that were
  // involved in the recomputation, we can safely report any orphan
  // children that remain.
  originalChildren.forEach(maybeReportOrphan);

  return valueGet(entry.value);
}

function recomputeNewValue(entry: AnyEntry) {
  entry.recomputing = true;
  // Set entry.value as unknown.
  entry.value.length = 0;
  try {
    // If entry.fn succeeds, entry.value will become a normal Value.
    entry.value[0] = entry.fn.apply(null, entry.args);
  } catch (e) {
    // If entry.fn throws, entry.value will become exceptional.
    entry.value[1] = e;
  }
  // Either way, this line is always reached.
  entry.recomputing = false;
}

function mightBeDirty(entry: AnyEntry) {
  return entry.dirty || !!(entry.dirtyChildren && entry.dirtyChildren.size);
}

function setClean(entry: AnyEntry) {
  entry.dirty = false;

  if (mightBeDirty(entry)) {
    // This Entry may still have dirty children, in which case we can't
    // let our parents know we're clean just yet.
    return;
  }

  reportClean(entry);
}

function reportDirty(child: AnyEntry) {
  child.parents.forEach(parent => reportDirtyChild(parent, child));
}

function reportClean(child: AnyEntry) {
  child.parents.forEach(parent => reportCleanChild(parent, child));
}

// Let a parent Entry know that one of its children may be dirty.
function reportDirtyChild(parent: AnyEntry, child: AnyEntry) {
  // Must have called rememberParent(child) before calling
  // reportDirtyChild(parent, child).
  assert(parent.childValues.has(child));
  assert(mightBeDirty(child));

  if (! parent.dirtyChildren) {
    parent.dirtyChildren = emptySetPool.pop() || new Set;

  } else if (parent.dirtyChildren.has(child)) {
    // If we already know this child is dirty, then we must have already
    // informed our own parents that we are dirty, so we can terminate
    // the recursion early.
    return;
  }

  parent.dirtyChildren.add(child);
  reportDirty(parent);
}

// Let a parent Entry know that one of its children is no longer dirty.
function reportCleanChild(parent: AnyEntry, child: AnyEntry) {
  // Must have called rememberChild(child) before calling
  // reportCleanChild(parent, child).
  assert(parent.childValues.has(child));
  assert(! mightBeDirty(child));

  const childValue = parent.childValues.get(child)!;
  if (childValue.length === 0) {
    parent.childValues.set(child, valueCopy(child.value));
  } else if (! valueIs(childValue, child.value)) {
    parent.setDirty();
  }

  removeDirtyChild(parent, child);

  if (mightBeDirty(parent)) {
    return;
  }

  reportClean(parent);
}

function removeDirtyChild(parent: AnyEntry, child: AnyEntry) {
  const dc = parent.dirtyChildren;
  if (dc) {
    dc.delete(child);
    if (dc.size === 0) {
      if (emptySetPool.length < POOL_TARGET_SIZE) {
        emptySetPool.push(dc);
      }
      parent.dirtyChildren = null;
    }
  }
}

// If the given entry has a reportOrphan method, and no remaining parents,
// call entry.reportOrphan and return true iff it returns true. The
// reportOrphan function should return true to indicate entry.dispose()
// has been called, and the entry has been removed from any other caches
// (see index.js for the only current example).
function maybeReportOrphan(entry: AnyEntry) {
  return entry.parents.size === 0 &&
    typeof entry.reportOrphan === "function" &&
    entry.reportOrphan() === true;
}

// Removes all children from this entry and returns an array of the
// removed children.
function forgetChildren(parent: AnyEntry) {
  let children = reusableEmptyArray;

  if (parent.childValues.size > 0) {
    children = [];
    parent.childValues.forEach((_value, child) => {
      forgetChild(parent, child);
      children.push(child);
    });
  }

  // After we forget all our children, this.dirtyChildren must be empty
  // and therefore must have been reset to null.
  assert(parent.dirtyChildren === null);

  return children;
}

function forgetChild(parent: AnyEntry, child: AnyEntry) {
  child.parents.delete(parent);
  parent.childValues.delete(child);
  removeDirtyChild(parent, child);
}

function maybeSubscribe(entry: AnyEntry) {
  if (typeof entry.subscribe === "function") {
    try {
      maybeUnsubscribe(entry); // Prevent double subscriptions.
      entry.unsubscribe = entry.subscribe.apply(null, entry.args);
    } catch (e) {
      // If this Entry has a subscribe function and it threw an exception
      // (or an unsubscribe function it previously returned now throws),
      // return false to indicate that we were not able to subscribe (or
      // unsubscribe), and this Entry should remain dirty.
      entry.setDirty();
      return false;
    }
  }

  // Returning true indicates either that there was no entry.subscribe
  // function or that it succeeded.
  return true;
}

function maybeUnsubscribe(entry: AnyEntry) {
  const { unsubscribe } = entry;
  if (typeof unsubscribe === "function") {
    entry.unsubscribe = void 0;
    unsubscribe();
  }
}
