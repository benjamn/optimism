import * as assert from "assert";
import { wrap, setTimeout, asyncFromGen, noContext } from '..';

describe("asyncFromGen", function () {
  it("is importable", function () {
    assert.strictEqual(typeof asyncFromGen, "function");
  });

  it("works like an async function", asyncFromGen(function*() {
    let sum = 0;
    const limit = yield new Promise(resolve => {
      setTimeout(() => resolve(10), 10);
    });
    for (let i = 0; i < limit; ++i) {
      sum += yield i + 1;
    }
    assert.strictEqual(sum, 55);
    return Promise.resolve("ok");
  }));

  it("properly handles exceptions", async function () {
    const fn = asyncFromGen(function*(throwee?: object) {
      const result = yield Promise.resolve("ok");
      if (throwee) {
        throw yield throwee;
      }
      return result;
    });

    const okPromise = fn();
    const expected = {};
    const koPromise = fn(expected);

    assert.strictEqual(await okPromise, "ok");

    try {
      await koPromise;
      throw new Error("not reached");
    } catch (error) {
      assert.strictEqual(error, expected);
    }

    try {
      await fn(Promise.resolve("oyez"));
      throw new Error("not reached");
    } catch (thrown) {
      assert.strictEqual(thrown, "oyez");
    }
  });

  it("can be cached", async function () {
    let parentCounter = 0;
    const parent = wrap(asyncFromGen(function*(x: number) {
      ++parentCounter;
      const a = yield new Promise<number>(resolve => setTimeout(() => {
        resolve(child(x));
      }, 10));
      const b = yield new Promise<number>(resolve => setTimeout(() => {
        resolve(child(x + 1));
      }, 20));
      return a * b;
    }));

    let childCounter = 0;
    const child = wrap((x: number) => {
      return ++childCounter;
    });

    assert.strictEqual(parentCounter, 0);
    assert.strictEqual(childCounter, 0);
    const parentPromise = parent(123);
    assert.strictEqual(parentCounter, 1);
    assert.strictEqual(await parentPromise, 2);
    assert.strictEqual(childCounter, 2);

    assert.strictEqual(parent(123), parentPromise);
    assert.strictEqual(parentCounter, 1);
    assert.strictEqual(childCounter, 2);

    child.dirty(123);

    assert.strictEqual(await parent(123), 3 * 2);
    assert.strictEqual(parentCounter, 2);
    assert.strictEqual(childCounter, 3);

    assert.strictEqual(await parent(456), 4 * 5);
    assert.strictEqual(parentCounter, 3);
    assert.strictEqual(childCounter, 5);

    assert.strictEqual(parent(666), parent(666));
    assert.strictEqual(await parent(666), await parent(666));
    assert.strictEqual(parentCounter, 4);
    assert.strictEqual(childCounter, 7);

    child.dirty(667);

    assert.strictEqual(await parent(667), 8 * 9);
    assert.strictEqual(await parent(667), 8 * 9);
    assert.strictEqual(parentCounter, 5);
    assert.strictEqual(childCounter, 9);

    assert.strictEqual(await parent(123), 3 * 2);
    assert.strictEqual(parentCounter, 5);
    assert.strictEqual(childCounter, 9);
  });
});

describe("noContext", function () {
  it("prevents registering dependencies", function () {
    let parentCounter = 0;
    const parent = wrap(() => {
      return [++parentCounter, noContext(child)];
    });

    let childCounter = 0;
    const child = wrap(() => ++childCounter);

    assert.deepEqual(parent(), [1, 1]);
    assert.deepEqual(parent(), [1, 1]);
    parent.dirty();
    assert.deepEqual(parent(), [2, 1]);
    // Calling child.dirty() does not dirty the parent:
    child.dirty();
    assert.deepEqual(parent(), [2, 1]);
    parent.dirty();
    assert.deepEqual(parent(), [3, 2]);
    assert.deepEqual(parent(), [3, 2]);
    parent.dirty();
    assert.deepEqual(parent(), [4, 2]);
  });
});