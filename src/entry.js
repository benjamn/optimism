const assert = require("assert");
const UNKNOWN_VALUE = Object.create(null);
const emptySetPool = [];
let currentParentEntry;

export class Entry {
  constructor(fn, key, args) {
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

  setDirty() {
    this.dirty = true;

    this.parents.forEach(parent => {
      parent.reportDirtyChild(this);
    });
  }

  reportDirtyChild(child) {
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
  }

  reportCleanChild(child) {
    assert(! child.dirty);

    this.childValues.set(child, child.value);

    let dc = this.dirtyChildren;
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
  }

  recomputeIfDirty() {
    if (this.dirty) {
      return this.recompute();
    }

    if (this.dirtyChildren) {
      this.dirtyChildren.forEach(child => {
        const oldValue = this.childValues.get(child);
        if (child.recomputeIfDirty() !== oldValue) {
          this.dirty = true;
        }
      });
    }

    if (this.dirty) {
      return this.recompute();
    }

    return this.value;
  }

  recompute() {
    this.forgetChildren();
    this.dirty = true;
    const oldParentEntry = currentParentEntry;
    currentParentEntry = this;
    try {
      this.value = this.fn(...this.args);
      this.dirty = false;
    } finally {
      currentParentEntry = oldParentEntry;
      if (! this.dirty) {
        this.updateParents();
        return this.value;
      }
    }
  }

  forgetChildren() {
    this.childValues.forEach(
      (value, child) => child.parents.delete(this));
    this.childValues.clear();

    const dc = this.dirtyChildren;
    if (dc) {
      dc.clear();
      emptySetPool.push(dc);
      this.dirtyChildren = null;
    }
  }

  updateParents() {
    if (currentParentEntry) {
      this.parents.add(currentParentEntry);
    }

    this.parents.forEach(parent => {
      parent.reportCleanChild(this);
    });
  }
}
