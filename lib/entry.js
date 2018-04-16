"use strict";

var getLocal = require("./local.js").get;
var UNKNOWN_VALUE = Object.create(null);
var emptySetPool = [];
var entryPool = [];

// Since this package might be used browsers, we should avoid using the
// Node built-in assert module.
function assert(condition, optionalMessage) {
  if (! condition) {
    throw new Error(optionalMessage || "assertion failure");
  }
}

function Entry(fn, args) {
  this.parents = new Set;
  this.childValues = new Map;

  // When this Entry has children that are dirty, this property becomes
  // a Set containing other Entry objects, borrowed from emptySetPool.
  // When the set becomes empty, it gets recycled back to emptySetPool.
  this.dirtyChildren = null;

  reset(this, fn, args);
}

function reset(entry, fn, args) {
  entry.fn = fn;
  entry.args = args;
  entry.value = UNKNOWN_VALUE;
  entry.dirty = true;
  entry.subscribe = null;
  entry.unsubscribe = null;
  entry.recomputing = false;
}

Entry.acquire = function (fn, args) {
  var entry = entryPool.pop();
  if (entry) {
    reset(entry, fn, args);
    return entry;
  }
  return new Entry(fn, args);
};

function release(entry) {
  assert(entry.parents.size === 0);
  forgetChildren(entry);
  entryPool.push(entry);
}

exports.Entry = Entry;

var Ep = Entry.prototype;

// The public API of Entry objects consists of the Entry constructor,
// along with the recompute, setDirty, and dispose methods.

Ep.recompute = function recompute() {
  rememberParent(this);
  return recomputeIfDirty(this);
};

Ep.setDirty = function setDirty() {
  if (this.dirty) return;
  this.dirty = true;
  this.value = UNKNOWN_VALUE;
  // Since we're explicitly setting this.dirty = true, we won't need to
  // examine any of our children in recomputeIfDirty, so we can go ahead
  // and forget them.
  forgetChildren(this);
  reportDirty(this);
};

Ep.dispose = function dispose() {
  var entry = this;
  forgetChildren(entry);
  unsubscribe(entry);

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
  entry.parents.forEach(function (parent) {
    // Causes parent to forget all of its children, including entry.
    parent.setDirty();
  });

  // Since this entry has no parents and no children anymore, and the
  // caller of Entry#dispose has indicated that entry.value no longer
  // matters, we can safely recycle this Entry object for later use.
  release(entry);
};

function setClean(entry) {
  entry.dirty = false;

  if (mightBeDirty(entry)) {
    // This Entry may still have dirty children, in which case we can't
    // let our parents know we're clean just yet.
    return;
  }

  reportClean(entry);
}

function reportDirty(entry) {
  entry.parents.forEach(function (parent) {
    reportDirtyChild(parent, entry);
  });
}

function reportClean(entry) {
  entry.parents.forEach(function (parent) {
    reportCleanChild(parent, entry);
  });
}

function mightBeDirty(entry) {
  return entry.dirty ||
    (entry.dirtyChildren &&
     entry.dirtyChildren.size);
}

// Let a parent Entry know that one of its children may be dirty.
function reportDirtyChild(entry, child) {
  // Must have called rememberParent(child) before calling
  // reportDirtyChild(parent, child).
  assert(entry.childValues.has(child));
  assert(mightBeDirty(child));

  if (! entry.dirtyChildren) {
    entry.dirtyChildren = emptySetPool.pop() || new Set;

  } else if (entry.dirtyChildren.has(child)) {
    // If we already know this child is dirty, then we must have already
    // informed our own parents that we are dirty, so we can terminate
    // the recursion early.
    return;
  }

  entry.dirtyChildren.add(child);
  reportDirty(entry);
}

// Let a parent Entry know that one of its children is no longer dirty.
function reportCleanChild(entry, child) {
  // Must have called rememberChild(child) before calling
  // reportCleanChild(parent, child).
  assert(entry.childValues.has(child));
  assert(! mightBeDirty(child));

  if (entry.childValues.get(child) !== child.value) {
    entry.setDirty();
  }

  removeDirtyChild(entry, child);

  if (mightBeDirty(entry)) {
    return;
  }

  reportClean(entry);
}

function removeDirtyChild(entry, child) {
  var dc = entry.dirtyChildren;
  if (dc) {
    dc.delete(child);
    if (dc.size === 0) {
      emptySetPool.push(dc);
      entry.dirtyChildren = null;
    }
  }
}

function rememberParent(entry) {
  var local = getLocal();
  var parent = local.currentParentEntry;
  if (parent) {
    entry.parents.add(parent);

    if (! parent.childValues.has(entry)) {
      parent.childValues.set(entry, UNKNOWN_VALUE);
    }

    if (mightBeDirty(entry)) {
      reportDirtyChild(parent, entry);
    } else {
      reportCleanChild(parent, entry);
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
function recomputeIfDirty(entry) {
  if (entry.dirty) {
    // If this Entry is explicitly dirty because someone called
    // entry.setDirty(), recompute.
    return reallyRecompute(entry);
  }

  if (mightBeDirty(entry)) {
    // Get fresh values for any dirty children, and if those values
    // disagree with this.childValues, mark this Entry explicitly dirty.
    entry.dirtyChildren.forEach(function (child) {
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

function reallyRecompute(entry) {
  assert(! entry.recomputing, "already recomputing");
  entry.recomputing = true;

  forgetChildren(entry);

  var local = getLocal();
  var parent = local.currentParentEntry;
  local.currentParentEntry = entry;

  var threw = true;
  try {
    entry.value = entry.fn.apply(null, entry.args);
    threw = false;

  } finally {
    entry.recomputing = false;

    assert(local.currentParentEntry === entry);
    local.currentParentEntry = parent;

    if (threw || ! subscribe(entry)) {
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

  return entry.value;
}

function forgetChildren(entry) {
  entry.childValues.forEach(function (value, child) {
    forgetChild(entry, child);
  });

  // After we forget all our children, this.dirtyChildren must be empty
  // and therefor must have been reset to null.
  assert(entry.dirtyChildren === null);
}

function forgetChild(entry, child) {
  child.parents.delete(entry);
  entry.childValues.delete(child);
  removeDirtyChild(entry, child);
}

function subscribe(entry) {
  if (typeof entry.subscribe === "function") {
    try {
      unsubscribe(entry); // Prevent double subscriptions.
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

function unsubscribe(entry) {
  var unsub = entry.unsubscribe;
  if (typeof unsub === "function") {
    entry.unsubscribe = null;
    unsub();
  }
}
