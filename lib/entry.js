"use strict";

var assert = require("assert");
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
}

exports.Entry = Entry;

var Ep = Entry.prototype;

Ep.setDirty = function setDirty() {
  this.dirty = true;
  this.parents.forEach(parent => {
    parent.reportDirtyChild(this);
  });
};

Ep.reportDirtyChild = function reportDirtyChild(child) {
  assert(this.childValues.has(child));

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

  this.parents.forEach(parent => {
    parent.reportDirtyChild(this);
  });
};

Ep.reportCleanChild = function reportCleanChild(child) {
  assert(! child.dirty);

  this.childValues.set(child, child.value);

  var dc = this.dirtyChildren;
  if (dc) {
    dc.delete(child);
    if (dc.size === 0) {
      emptySetPool.push(dc);
      dc = this.dirtyChildren = null;
    }
  }

  if (this.dirty || dc) {
    // This Entry is not clean, either because it's explicitly dirty or
    // because it still has dirty children, so we can't report it as
    // clean to its parents.
    return;
  }

  this.parents.forEach(parent => {
    parent.reportCleanChild(this);
  });
};

// This is the most important method of the Entry API, because it
// determines whether the cached entry.value can be returned immediately,
// or must be recomputed. The overall performance of the caching system
// depends on the truth of the following observations: (1) this.dirty is
// usually false, (2) this.dirtyChildren is usually null/empty, and thus
// (3) this.value is usally returned very quickly, without recomputation.
Ep.recomputeIfDirty = function recomputeIfDirty() {
  if (this.dirty) {
    // If this Entry is explicitly dirty because someone called
    // entry.setDirty(), recompute.
    return this.recompute();
  }

  if (this.dirtyChildren) {
    // Get fresh values for any dirty children, and if those values
    // disagree with this.childValues, mark this Entry explicitly dirty.
    this.dirtyChildren.forEach(child => {
      var oldValue = this.childValues.get(child);
      if (child.recomputeIfDirty() !== oldValue) {
        this.dirty = true;
      }
    });
  }

  if (this.dirty) {
    // If this Entry has become explicitly dirty after comparing the fresh
    // values of its dirty children against this.childValues, recompute.
    return this.recompute();
  }

  assert.notStrictEqual(this.value, UNKNOWN_VALUE);

  return this.value;
};

var currentParentEntry;

Ep.recompute = function recompute() {
  this.forgetChildren();
  this.dirty = true;
  var oldParentEntry = currentParentEntry;
  currentParentEntry = this;
  try {
    this.value = this.fn.apply(null, this.args);
    this.dirty = false;
  } finally {
    currentParentEntry = oldParentEntry;
    if (! this.dirty) {
      this.updateParents();
      return this.value;
    }
  }
};

Ep.forgetChildren = function forgetChildren() {
  this.childValues.forEach(
    (value, child) => child.parents.delete(this)
  );

  this.childValues.clear();

  var dc = this.dirtyChildren;
  if (dc) {
    dc.clear();
    emptySetPool.push(dc);
    this.dirtyChildren = null;
  }
};

Ep.updateParents = function updateParents() {
  if (currentParentEntry) {
    this.parents.add(currentParentEntry);
  }

  this.parents.forEach(parent => {
    parent.reportCleanChild(this);
  });
};
