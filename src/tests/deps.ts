import * as assert from "assert";
import { wrap, dep } from "../index";

describe("OptimisticDependencyFunction<TKey>", () => {
  it("can dirty OptimisticWrapperFunctions", () => {
    const numberDep = dep<number>();
    const stringDep = dep<string>();
    let callCount = 0;

    const fn = wrap((n: number, s: string) => {
      numberDep(n);
      stringDep(s);
      ++callCount;
      return s.repeat(n);
    });

    assert.strictEqual(fn(0, "oyez"), "");
    assert.strictEqual(callCount, 1);
    assert.strictEqual(fn(1, "oyez"), "oyez");
    assert.strictEqual(callCount, 2);
    assert.strictEqual(fn(2, "oyez"), "oyezoyez");
    assert.strictEqual(callCount, 3);

    assert.strictEqual(fn(0, "oyez"), "");
    assert.strictEqual(fn(1, "oyez"), "oyez");
    assert.strictEqual(fn(2, "oyez"), "oyezoyez");
    assert.strictEqual(callCount, 3);

    numberDep.dirty(0);
    assert.strictEqual(fn(0, "oyez"), "");
    assert.strictEqual(callCount, 4);
    assert.strictEqual(fn(1, "oyez"), "oyez");
    assert.strictEqual(callCount, 4);
    assert.strictEqual(fn(2, "oyez"), "oyezoyez");
    assert.strictEqual(callCount, 4);

    stringDep.dirty("mlem");
    assert.strictEqual(fn(0, "oyez"), "");
    assert.strictEqual(callCount, 4);

    stringDep.dirty("oyez");
    assert.strictEqual(fn(2, "oyez"), "oyezoyez");
    assert.strictEqual(callCount, 5);
    assert.strictEqual(fn(1, "oyez"), "oyez");
    assert.strictEqual(callCount, 6);
    assert.strictEqual(fn(0, "oyez"), "");
    assert.strictEqual(callCount, 7);

    assert.strictEqual(fn(0, "oyez"), "");
    assert.strictEqual(fn(1, "oyez"), "oyez");
    assert.strictEqual(fn(2, "oyez"), "oyezoyez");
    assert.strictEqual(callCount, 7);
  });

  it("should be forgotten when parent is recomputed", () => {
    const d = dep<string>();
    let callCount = 0;
    let shouldDepend = true;

    const parent = wrap((id: string) => {
      if (shouldDepend) d(id);
      return ++callCount;
    });

    assert.strictEqual(parent("oyez"), 1);
    assert.strictEqual(parent("oyez"), 1);
    assert.strictEqual(parent("mlem"), 2);
    assert.strictEqual(parent("mlem"), 2);

    d.dirty("mlem");
    assert.strictEqual(parent("oyez"), 1);
    assert.strictEqual(parent("mlem"), 3);

    d.dirty("oyez");
    assert.strictEqual(parent("oyez"), 4);
    assert.strictEqual(parent("mlem"), 3);

    parent.dirty("oyez");
    shouldDepend = false;
    assert.strictEqual(parent("oyez"), 5);
    assert.strictEqual(parent("mlem"), 3);
    d.dirty("oyez");
    shouldDepend = true;
    assert.strictEqual(parent("oyez"), 5);
    assert.strictEqual(parent("mlem"), 3);
    // This still has no effect because the previous call to parent("oyez")
    // was cached.
    d.dirty("oyez");
    assert.strictEqual(parent("oyez"), 5);
    assert.strictEqual(parent("mlem"), 3);
    parent.dirty("oyez");
    assert.strictEqual(parent("oyez"), 6);
    assert.strictEqual(parent("mlem"), 3);
    d.dirty("oyez");
    assert.strictEqual(parent("oyez"), 7);
    assert.strictEqual(parent("mlem"), 3);

    parent.dirty("mlem");
    shouldDepend = false;
    assert.strictEqual(parent("oyez"), 7);
    assert.strictEqual(parent("mlem"), 8);
    d.dirty("oyez");
    d.dirty("mlem");
    assert.strictEqual(parent("oyez"), 9);
    assert.strictEqual(parent("mlem"), 8);
    d.dirty("oyez");
    d.dirty("mlem");
    assert.strictEqual(parent("oyez"), 9);
    assert.strictEqual(parent("mlem"), 8);
    shouldDepend = true;
    parent.dirty("mlem");
    assert.strictEqual(parent("oyez"), 9);
    assert.strictEqual(parent("mlem"), 10);
    d.dirty("oyez");
    d.dirty("mlem");
    assert.strictEqual(parent("oyez"), 9);
    assert.strictEqual(parent("mlem"), 11);
  });
});
