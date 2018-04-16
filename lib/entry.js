"use strict";

var assert = require("assert");
var getLocal = require("./local.js").get;
var UNKNOWN_VALUE = Object.create(null);

function Entry(fn, args) {
  this.fn = fn;
  this.args = args;
  this.value = UNKNOWN_VALUE;
  this.dirty = true;
  this.parents = new Set;
  this.childValues = new Map;
  this.dirtyChildren = new Set;
  this.subscribe = null;
  this.unsubscribe = null;
}

exports.Entry = Entry;

var Ep = Entry.prototype;

Ep.setDirty = function setDirty() {
  if (this.dirty) return;
  this.dirty = true;
  reportDirty(this);
};

Ep.mightBeDirty = function mightBeDirty() {
  return this.dirty || this.dirtyChildren.size;
};

Ep.recompute = function recompute() {
  var parent = rememberParent(this);
  var value = recomputeIfDirty(this);
  if (parent) {
    parent.childValues.set(this, this.value);
    removeDirtyChild(parent, this);
  }
  return value;
};

Ep.dispose = function dispose() {
  // If we're no longer going to be subscribed to changes affecting this
  // Entry, then we'd better inform its parents that it needs to be
  // recomputed.
  this.setDirty();
  forgetChildren(this);
  unsubscribe(this);
};

function forgetChild(entry, child) {
  child.parents.delete(entry);
  removeDirtyChild(entry, child);
  entry.childValues.delete(child);
}

function setClean(entry) {
  entry.dirty = false;

  if (entry.dirtyChildren.size) {
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

// Let a parent Entry know that one of its children may be dirty.
function reportDirtyChild(entry, child) {
  // Must have called rememberParent(child) before calling
  // reportDirtyChild(parent, child).
  assert(entry.childValues.has(child));
  assert(child.mightBeDirty());

  if (entry.dirtyChildren.has(child)) {
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
  assert(! child.mightBeDirty());
  if (entry.childValues.get(child) !== child.value) {
    entry.setDirty();
  }
  removeDirtyChild(entry, child);
}

// Often we are removing a child because it is no longer dirty, so
// child.dirty is not a precondition for this method. Also note that the
// child may remain in this.childValues, so we definitely do not want to
// call child.parents.delete(this) here.
function removeDirtyChild(entry, child) {
  entry.dirtyChildren.delete(child);

  if (entry.dirty || entry.dirtyChildren.size) {
    return;
  }

  reportClean(entry);
}

function rememberParent(entry) {
  var local = getLocal();
  var parent = local.currentParentEntry;
  if (parent) {
    entry.parents.add(parent);

    if (! parent.childValues.has(entry)) {
      parent.childValues.set(entry, UNKNOWN_VALUE);
    }

    if (entry.mightBeDirty()) {
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

  if (entry.dirtyChildren.size) {
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

  assert.notStrictEqual(entry.value, UNKNOWN_VALUE);

  return entry.value;
}

function reallyRecompute(entry) {
  forgetChildren(entry);

  var local = getLocal();
  var parent = local.currentParentEntry;
  local.currentParentEntry = entry;

  var threw = true;
  try {
    entry.value = entry.fn.apply(null, entry.args);
    threw = false;

  } finally {
    assert.strictEqual(local.currentParentEntry, entry);
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

  // After we forget all our children, this.dirtyChildren must be empty.
  assert.strictEqual(entry.dirtyChildren.size, 0);
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
