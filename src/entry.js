const assert = require("assert");
const UNKNOWN_VALUE = Object.create(null);
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
    this.dirtyChildren = new Set;
  }

  setDirty() {
    this.dirty = true;

    this.parents.forEach(parent => {
      parent.reportDirtyChild(this);
    });
  }

  reportDirtyChild(child) {
    assert(this.childValues.has(child));

    this.dirtyChildren.add(child);

    this.parents.forEach(parent => {
      parent.reportDirtyChild(this);
    })
  }

  reportCleanChild(child) {
    assert(! child.dirty);

    this.childValues.set(child, child.value);
    this.dirtyChildren.delete(child);

    if (this.dirty ||
        this.dirtyChildren.size > 0) {
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

    this.dirtyChildren.forEach(child => {
      const oldValue = this.childValues.get(child);
      if (child.recomputeIfDirty() !== oldValue) {
        this.dirty = true;
      }
    });

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
    this.dirtyChildren.clear();
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
