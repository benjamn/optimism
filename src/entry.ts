import { get as getLocal } from "./local";
import { OptimisticWrapOptions } from "./index";

const UNKNOWN_VALUE = Object.create(null);
const emptySetPool: Set<Entry>[] = [];
const reusableEmptyArray: Entry[] = [];

// Since this package might be used browsers, we should avoid using the
// Node built-in assert module.
function assert(condition: any, optionalMessage?: string) {
  if (! condition) {
    throw new Error(optionalMessage || "assertion failure");
  }
}

type FnType = (...args: any[]) => any;

export class Entry {
  public static count = 0;
  public static POOL_TARGET_SIZE = 100;

  public subscribe: OptimisticWrapOptions["subscribe"];
  public unsubscribe?: () => any;
  public reportOrphan?: (entry: Entry) => any;

  private parents = new Set<Entry>();
  private childValues = new Map<Entry, any>();

  // When this Entry has children that are dirty, this property becomes
  // a Set containing other Entry objects, borrowed from emptySetPool.
  // When the set becomes empty, it gets recycled back to emptySetPool.
  private dirtyChildren: Set<Entry> | null = null;

  private dirty = true;
  private recomputing = false;
  private value: any;

  constructor(
    public fn: FnType,
    public key: any,
    public args: any[],
  ) {
    ++Entry.count;
  }

  public recompute() {
    if (! this.rememberParent() && this.maybeReportOrphan()) {
      // The recipient of the entry.reportOrphan callback decided to dispose
      // of this orphan entry by calling entry.dispose(), so we don't need to
      // (and should not) proceed with the recomputation.
      return;
    }

    return this.recomputeIfDirty();
  }

  public isOrphan() {
    return this.parents.size === 0;
  }

  public setDirty() {
    if (this.dirty) return;
    this.dirty = true;
    this.value = UNKNOWN_VALUE;
    this.reportDirty();
    // We can go ahead and unsubscribe here, since any further dirty
    // notifications we receive will be redundant, and unsubscribing may
    // free up some resources, e.g. file watchers.
    this.maybeUnsubscribe();
  }

  public dispose() {
    this.forgetChildren().forEach(child => child.maybeReportOrphan());
    this.maybeUnsubscribe();

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
      parent.forgetChild(this);
    });
  }

  private rememberParent() {
    const local = getLocal();
    const parent = local.currentParentEntry;
    if (parent) {
      this.parents.add(parent);

      if (! parent.childValues.has(this)) {
        parent.childValues.set(this, UNKNOWN_VALUE);
      }

      if (this.mightBeDirty()) {
        parent.reportDirtyChild(this);
      } else {
        parent.reportCleanChild(this);
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
  private recomputeIfDirty() {
    if (this.dirty) {
      // If this Entry is explicitly dirty because someone called
      // entry.setDirty(), recompute.
      return this.reallyRecompute();
    }

    if (this.mightBeDirty()) {
      // Get fresh values for any dirty children, and if those values
      // disagree with this.childValues, mark this Entry explicitly dirty.
      this.dirtyChildren!.forEach(child => {
        assert(this.childValues.has(child));
        try {
          child.recomputeIfDirty();
        } catch (e) {
          this.setDirty();
        }
      });

      if (this.dirty) {
        // If this Entry has become explicitly dirty after comparing the fresh
        // values of its dirty children against this.childValues, recompute.
        return this.reallyRecompute();
      }
    }

    assert(this.value !== UNKNOWN_VALUE);

    return this.value;
  }

  private reallyRecompute() {
    assert(! this.recomputing, "already recomputing");
    this.recomputing = true;

    // Since this recomputation is likely to re-remember some of this
    // entry's children, we forget our children here but do not call
    // maybeReportOrphan until after the recomputation finishes.
    const originalChildren = this.forgetChildren();

    const local = getLocal();
    const parent = local.currentParentEntry;
    local.currentParentEntry = this;

    let threw = true;
    try {
      this.value = this.fn.apply(null, this.args);
      threw = false;

    } finally {
      this.recomputing = false;

      assert(local.currentParentEntry === this);
      local.currentParentEntry = parent;

      if (threw || ! this.maybeSubscribe()) {
        // Mark this Entry dirty if entry.fn threw or we failed to
        // resubscribe. This is important because, if we have a subscribe
        // function and it failed, then we're going to miss important
        // notifications about the potential dirtiness of entry.value.
        this.setDirty();
      } else {
        // If we successfully recomputed entry.value and did not fail to
        // (re)subscribe, then this Entry is no longer explicitly dirty.
        this.setClean();
      }
    }

    // Now that we've had a chance to re-remember any children that were
    // involved in the recomputation, we can safely report any orphan
    // children that remain.
    originalChildren.forEach(child => child.maybeReportOrphan());

    return this.value;
  }

  private mightBeDirty() {
    return this.dirty || !!(this.dirtyChildren && this.dirtyChildren.size);
  }

  private setClean() {
    this.dirty = false;

    if (this.mightBeDirty()) {
      // This Entry may still have dirty children, in which case we can't
      // let our parents know we're clean just yet.
      return;
    }

    this.reportClean();
  }

  private reportDirty() {
    this.parents.forEach(parent => parent.reportDirtyChild(this));
  }

  private reportClean() {
    this.parents.forEach(parent => parent.reportCleanChild(this));
  }

  // Let a parent Entry know that one of its children may be dirty.
  private reportDirtyChild(child: Entry) {
    // Must have called rememberParent(child) before calling
    // reportDirtyChild(parent, child).
    assert(this.childValues.has(child));
    assert(child.mightBeDirty());

    if (! this.dirtyChildren) {
      this.dirtyChildren = emptySetPool.pop() || new Set;

    } else if (this.dirtyChildren.has(child)) {
      // If we already know this child is dirty, then we must have already
      // informed our own parents that we are dirty, so we can terminate
      // the recursion early.
      return;
    }

    this.dirtyChildren.add(child);
    this.reportDirty();
  }

  // Let a parent Entry know that one of its children is no longer dirty.
  private reportCleanChild(child: Entry) {
    // Must have called rememberChild(child) before calling
    // reportCleanChild(parent, child).
    assert(this.childValues.has(child));
    assert(! child.mightBeDirty());

    const childValue = this.childValues.get(child);
    if (childValue === UNKNOWN_VALUE) {
      this.childValues.set(child, child.value);
    } else if (childValue !== child.value) {
      this.setDirty();
    }

    this.removeDirtyChild(child);

    if (this.mightBeDirty()) {
      return;
    }

    this.reportClean();
  }

  private removeDirtyChild(child: Entry) {
    const dc = this.dirtyChildren;
    if (dc) {
      dc.delete(child);
      if (dc.size === 0) {
        if (emptySetPool.length < Entry.POOL_TARGET_SIZE) {
          emptySetPool.push(dc);
        }
        this.dirtyChildren = null;
      }
    }
  }

  // If the given entry has a reportOrphan method, and no remaining parents,
  // call entry.reportOrphan and return true iff it returns true. The
  // reportOrphan function should return true to indicate entry.dispose()
  // has been called, and the entry has been removed from any other caches
  // (see index.js for the only current example).
  private maybeReportOrphan() {
    const report = this.reportOrphan;
    return typeof report === "function" &&
      this.parents.size === 0 &&
      report(this) === true;
  }

  // Removes all children from this entry and returns an array of the
  // removed children.
  private forgetChildren() {
    let children = reusableEmptyArray;

    if (this.childValues.size > 0) {
      children = [];
      this.childValues.forEach((value, child) => {
        this.forgetChild(child);
        children.push(child);
      });
    }

    // After we forget all our children, this.dirtyChildren must be empty
    // and therefore must have been reset to null.
    assert(this.dirtyChildren === null);

    return children;
  }

  private forgetChild(child: Entry) {
    child.parents.delete(this);
    this.childValues.delete(child);
    this.removeDirtyChild(child);
  }

  private maybeSubscribe() {
    if (typeof this.subscribe === "function") {
      try {
        this.maybeUnsubscribe(); // Prevent double subscriptions.
        this.unsubscribe = this.subscribe.apply(null, this.args);
      } catch (e) {
        // If this Entry has a subscribe function and it threw an exception
        // (or an unsubscribe function it previously returned now throws),
        // return false to indicate that we were not able to subscribe (or
        // unsubscribe), and this Entry should remain dirty.
        this.setDirty();
        return false;
      }
    }

    // Returning true indicates either that there was no entry.subscribe
    // function or that it succeeded.
    return true;
  }

  private maybeUnsubscribe() {
    const { unsubscribe } = this;
    if (typeof unsubscribe === "function") {
      this.unsubscribe = void 0;
      unsubscribe();
    }
  }
}
