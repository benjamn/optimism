"use strict";

var assert = require("assert");
var getLocal = require("./local.js").get;
var UNKNOWN_VALUE = Object.create(null);
var emptySetPool = [];

function Entry(fn, key, args) {
  assert(this instanceof Entry);

  this.fn = fn;
  this.key = key;
  this.args = args;
  this.value = UNKNOWN_VALUE;
  this.dirty = true;
  this.parents = new Set;
  this.childValues = new Map;

  // When this Entry has children that are dirty, this property becomes
  // a Set containing other Entry objects, borrowed from emptySetPool.
  // When the set becomes empty, it gets recycled back to emptySetPool.
  this.dirtyChildren = null;

  this.subscribe = null;
  this.unsubscribe = null;
}

exports.Entry = Entry;

var Ep = Entry.prototype;

Ep.setDirty = function setDirty() {
  if (this.dirty) return;
  this.dirty = true;
  this.parents.forEach(reportDirty, this);
};

Ep.mightBeDirty = function mightBeDirty() {
  return this.dirty ||
    (this.dirtyChildren &&
     this.dirtyChildren.size > 0);
};

Ep.recompute = function recompute() {
  var parent = this._rememberParent();
  var value = this._recomputeIfDirty();
  if (parent) {
    parent.childValues.set(this, this.value);
    parent._removeDirtyChild(this);
  }
  return value;
};

Ep.dispose = function dispose() {
  // If we're no longer going to be subscribed to changes affecting this
  // Entry, then we'd better inform its parents that it needs to be
  // recomputed.
  this.setDirty();
  this._forgetChildren();
  unsubscribe(this);
};

Ep._rememberChild = function _rememberChild(child) {
  child.parents.add(this);

  if (! this.childValues.has(child)) {
    this.childValues.set(child, UNKNOWN_VALUE);
  }

  if (child.mightBeDirty()) {
    this._reportDirtyChild(child);
  } else {
    this._reportCleanChild(child);
  }
};

Ep._forgetChild = function _forgetChild(child) {
  child.parents.delete(this);
  this._removeDirtyChild(child);
  this.childValues.delete(child);
};

Ep._setClean = function _setClean() {
  this.dirty = false;

  if (this.dirtyChildren &&
      this.dirtyChildren.size > 0) {
    // This Entry may still have dirty children, in which case we can't
    // let our parents know we're clean just yet.
    return;
  }

  this.parents.forEach(reportClean, this);
};

function reportDirty(parent) {
  parent._reportDirtyChild(this);
}

function reportClean(parent) {
  parent._reportCleanChild(this);
}

// Let a parent Entry know that one of its children may be dirty.
Ep._reportDirtyChild = function _reportDirtyChild(child) {
  // Must have called this._rememberChild(child) before calling
  // this._reportDirtyChild(child).
  assert(this.childValues.has(child));
  assert(child.mightBeDirty());

  if (! this.dirtyChildren) {
    // Initialize this.dirtyChildren with an empty set drawn from the
    // emptySetPool if possible.
    this.dirtyChildren = emptySetPool.pop() || new Set;

  } else if (this.dirtyChildren.has(child)) {
    // If we already know this child is dirty, then we must have already
    // informed our own parents that we are dirty, so we can terminate
    // the recursion early.
    return;
  }

  this.dirtyChildren.add(child);
  this.parents.forEach(reportDirty, this);
};

// Let a parent Entry know that one of its children is no longer dirty.
Ep._reportCleanChild = function _reportCleanChild(child) {
  // Must have called this._rememberChild(child) before calling
  // this._reportCleanChild(child).
  assert(this.childValues.has(child));
  assert(! child.mightBeDirty());
  if (this.childValues.get(child) !== child.value) {
    this.setDirty();
  }
  this._removeDirtyChild(child);
};

// Often we are removing a child because it is no longer dirty, so
// child.dirty is not a precondition for this method. Also note that the
// child may remain in this.childValues, so we definitely do not want to
// call child.parents.delete(this) here.
Ep._removeDirtyChild = function _removeDirtyChild(child) {
  var dc = this.dirtyChildren;
  if (dc) {
    dc.delete(child);
    if (dc.size === 0) {
      emptySetPool.push(dc);
      dc = this.dirtyChildren = null;
    }
  }

  if (this.dirty || dc) {
    return;
  }

  this.parents.forEach(reportClean, this);
};

Ep._rememberParent = function _rememberParent() {
  var local = getLocal();
  var parent = local.currentParentEntry;
  if (parent) {
    parent._rememberChild(this);
    return parent;
  }
};

// This is the most important method of the Entry API, because it
// determines whether the cached entry.value can be returned immediately,
// or must be recomputed. The overall performance of the caching system
// depends on the truth of the following observations: (1) this.dirty is
// usually false, (2) this.dirtyChildren is usually null/empty, and thus
// (3) this.value is usally returned very quickly, without recomputation.
Ep._recomputeIfDirty = function _recomputeIfDirty() {
  if (this.dirty) {
    // If this Entry is explicitly dirty because someone called
    // entry.setDirty(), recompute.
    return this._reallyRecompute();
  }

  if (this.dirtyChildren) {
    // Get fresh values for any dirty children, and if those values
    // disagree with this.childValues, mark this Entry explicitly dirty.
    this.dirtyChildren.forEach(function (child) {
      assert(this.childValues.has(child));
      try {
        child._recomputeIfDirty();
      } catch (e) {
        this.setDirty();
      }
    }, this);
  }

  if (this.dirty) {
    // If this Entry has become explicitly dirty after comparing the fresh
    // values of its dirty children against this.childValues, recompute.
    return this._reallyRecompute();
  }

  assert.notStrictEqual(this.value, UNKNOWN_VALUE);

  return this.value;
};

Ep._reallyRecompute = function _reallyRecompute() {
  this._forgetChildren();

  var local = getLocal();
  var parent = local.currentParentEntry;
  local.currentParentEntry = this;

  var threw = true;
  try {
    this.value = this.fn.apply(null, this.args);
    threw = false;

  } finally {
    assert.strictEqual(local.currentParentEntry, this);
    local.currentParentEntry = parent;

    if (threw || ! subscribe(this)) {
      // Mark this Entry dirty if this.fn threw or we failed to
      // resubscribe. This is important because, if we have a subscribe
      // function and it failed, then we're going to miss important
      // notifications about the potential dirtiness of this.value.
      this.setDirty();
    } else {
      // If we successfully recomputed this.value and did not fail to
      // (re)subscribe, then this Entry is no longer explicitly dirty.
      this._setClean();
    }
  }

  return this.value;
};

Ep._forgetChildren = function _forgetChildren() {
  this.childValues.forEach(function (value, child) {
    this._forgetChild(child);
  }, this);

  // After we forget all our children, this.dirtyChildren must be empty
  // and thus have been reset to null.
  assert.strictEqual(this.dirtyChildren, null);
};

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
