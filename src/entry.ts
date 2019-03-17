import { get as getLocal } from "./local";
import { OptimisticWrapOptions } from "./index";

const UNKNOWN_VALUE = Object.create(null);
const emptySetPool: Set<AnyEntry>[] = [];
const reusableEmptyArray: AnyEntry[] = [];

// Since this package might be used browsers, we should avoid using the
// Node built-in assert module.
function assert(condition: any, optionalMessage?: string) {
  if (! condition) {
    throw new Error(optionalMessage || "assertion failure");
  }
}

export type AnyEntry = Entry<any, any, any>;

export class Entry<TArgs extends any[], TValue, TKey> {
  public static count = 0;
  public static POOL_TARGET_SIZE = 100;

  public subscribe: OptimisticWrapOptions<TArgs>["subscribe"];
  public unsubscribe?: () => any;
  public reportOrphan?: (entry: Entry<TArgs, TValue, TKey>) => any;

  public readonly parents = new Set<AnyEntry>();
  public readonly childValues = new Map<AnyEntry, any>();

  // When this Entry has children that are dirty, this property becomes
  // a Set containing other Entry objects, borrowed from emptySetPool.
  // When the set becomes empty, it gets recycled back to emptySetPool.
  public dirtyChildren: Set<AnyEntry> | null = null;

  public dirty = true;
  public recomputing = false;
  public value: TValue = UNKNOWN_VALUE;

  constructor(
    public readonly fn: (...args: TArgs) => TValue,
    public args: TArgs,
    public readonly key: TKey,
  ) {
    ++Entry.count;
  }

  public recompute(): TValue {
    if (! rememberParent(this) && maybeReportOrphan(this)) {
      // The recipient of the entry.reportOrphan callback decided to dispose
      // of this orphan entry by calling entry.dispose(), so we don't need to
      // (and should not) proceed with the recomputation.
      return void 0 as any;
    }

    return recomputeIfDirty(this);
  }

  public isOrphan() {
    return this.parents.size === 0;
  }

  public setDirty() {
    if (this.dirty) return;
    this.dirty = true;
    this.value = UNKNOWN_VALUE;
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
  const local = getLocal();
  const parent = local.currentParentEntry;
  if (parent) {
    child.parents.add(parent);

    if (! parent.childValues.has(child)) {
      parent.childValues.set(child, UNKNOWN_VALUE);
    }

    if (mightBeDirty(child)) {
      reportDirtyChild(parent, child);
    } else {
      reportCleanChild(parent, child);
    }

    return parent;
  }
}

// This is the most important method of the Entry API, because it
// determines whether the cached entry.value can be returned immediately,
// or must be recomputed. The overall performance of the caching system
// depends on the truth of the following observations: (1) this.dirty is
// usually false, (2) this.dirtyChildren is usually null/empty, and thus
// (3) this.value is usally returned very quickly, without recomputation.
function recomputeIfDirty(entry: AnyEntry) {
  if (entry.dirty) {
    // If this Entry is explicitly dirty because someone called
    // entry.setDirty(), recompute.
    return reallyRecompute(entry);
  }

  if (mightBeDirty(entry)) {
    // Get fresh values for any dirty children, and if those values
    // disagree with this.childValues, mark this Entry explicitly dirty.
    entry.dirtyChildren!.forEach(child => {
      assert(entry.childValues.has(child));
      try {
        recomputeIfDirty(child);
      } catch (e) {
        entry.setDirty();
      }
    });

    if (entry.dirty) {
      // If this Entry has become explicitly dirty after comparing the fresh
      // values of its dirty children against this.childValues, recompute.
      return reallyRecompute(entry);
    }
  }

  assert(entry.value !== UNKNOWN_VALUE);

  return entry.value;
}

function reallyRecompute(entry: AnyEntry) {
  assert(! entry.recomputing, "already recomputing");
  entry.recomputing = true;

  // Since this recomputation is likely to re-remember some of this
  // entry's children, we forget our children here but do not call
  // maybeReportOrphan until after the recomputation finishes.
  const originalChildren = forgetChildren(entry);

  const local = getLocal();
  const parent = local.currentParentEntry;
  local.currentParentEntry = entry;

  let threw = true;
  try {
    entry.value = entry.fn.apply(null, entry.args);
    threw = false;

  } finally {
    entry.recomputing = false;

    assert(local.currentParentEntry === entry);
    local.currentParentEntry = parent;

    if (threw || ! maybeSubscribe(entry)) {
      // Mark this Entry dirty if entry.fn threw or we failed to
      // resubscribe. This is important because, if we have a subscribe
      // function and it failed, then we're going to miss important
      // notifications about the potential dirtiness of entry.value.
      entry.setDirty();
    } else {
      // If we successfully recomputed entry.value and did not fail to
      // (re)subscribe, then this Entry is no longer explicitly dirty.
      setClean(entry);
    }
  }

  // Now that we've had a chance to re-remember any children that were
  // involved in the recomputation, we can safely report any orphan
  // children that remain.
  originalChildren.forEach(maybeReportOrphan);

  return entry.value;
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

  const childValue = parent.childValues.get(child);
  if (childValue === UNKNOWN_VALUE) {
    parent.childValues.set(child, child.value);
  } else if (childValue !== child.value) {
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
      if (emptySetPool.length < Entry.POOL_TARGET_SIZE) {
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
  const report = entry.reportOrphan;
  return typeof report === "function" &&
    entry.parents.size === 0 &&
    report(entry) === true;
}

// Removes all children from this entry and returns an array of the
// removed children.
function forgetChildren(parent: AnyEntry) {
  let children = reusableEmptyArray;

  if (parent.childValues.size > 0) {
    children = [];
    parent.childValues.forEach((value, child) => {
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
