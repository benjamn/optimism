import * as assert from "assert";
import { createHash } from "crypto";
import {
  wrap,
  defaultMakeCacheKey,
  OptimisticWrapperFunction,
} from "../index";

type NumThunk = OptimisticWrapperFunction<[], number>;

describe("optimism", function () {
  it("sanity", function () {
    assert.strictEqual(typeof wrap, "function");
    assert.strictEqual(typeof defaultMakeCacheKey, "function");
  });

  it("works with single functions", function () {
    const test = wrap(function (x: string) {
      return x + salt;
    }, {
      makeCacheKey: function (x: string) {
        return x;
      }
    });

    let salt = "salt";
    assert.strictEqual(test("a"), "asalt");

    salt = "NaCl";
    assert.strictEqual(test("a"), "asalt");
    assert.strictEqual(test("b"), "bNaCl");

    test.dirty("a");
    assert.strictEqual(test("a"), "aNaCl");
  });

  it("works with two layers of functions", function () {
    const files: { [key: string]: string } = {
      "a.js": "a",
      "b.js": "b"
    };

    const fileNames = Object.keys(files);

    const read = wrap(function (path: string) {
      return files[path];
    });

    const hash = wrap(function (paths: string[]) {
      const h = createHash("sha1");
      paths.forEach(function (path) {
        h.update(read(path));
      });
      return h.digest("hex");
    });

    const hash1 = hash(fileNames);
    files["a.js"] += "yy";
    const hash2 = hash(fileNames);
    read.dirty("a.js");
    const hash3 = hash(fileNames);
    files["b.js"] += "ee";
    read.dirty("b.js");
    const hash4 = hash(fileNames);

    assert.strictEqual(hash1, hash2);
    assert.notStrictEqual(hash1, hash3);
    assert.notStrictEqual(hash1, hash4);
    assert.notStrictEqual(hash3, hash4);
  });

  it("works with subscription functions", function () {
    let dirty: () => void;
    let sep = ",";
    const unsubscribed = Object.create(null);
    const test = wrap(function (x: string) {
      return [x, x, x].join(sep);
    }, {
      max: 1,
      subscribe: function (x: string) {
        dirty = function () {
          test.dirty(x);
        };

        delete unsubscribed[x];

        return function () {
          unsubscribed[x] = true;
        };
      }
    });

    assert.strictEqual(test("a"), "a,a,a");

    assert.strictEqual(test("b"), "b,b,b");
    assert.deepEqual(unsubscribed, { a: true });

    assert.strictEqual(test("c"), "c,c,c");
    assert.deepEqual(unsubscribed, {
      a: true,
      b: true
    });

    sep = ":";

    assert.strictEqual(test("c"), "c,c,c");
    assert.deepEqual(unsubscribed, {
      a: true,
      b: true
    });

    dirty!();

    assert.strictEqual(test("c"), "c:c:c");
    assert.deepEqual(unsubscribed, {
      a: true,
      b: true
    });

    assert.strictEqual(test("d"), "d:d:d");
    assert.deepEqual(unsubscribed, {
      a: true,
      b: true,
      c: true
    });
  });

  it("is not confused by fibers", function () {
    const Fiber = require("fibers");
    const order = [];
    let result1 = "one";
    let result2 = "two";

    const f1 = new Fiber(function () {
      order.push(1);

      const o1 = wrap(function () {
        Fiber.yield();
        return result1;
      });

      order.push(2);
      assert.strictEqual(o1(), "one");
      order.push(3);
      result1 += ":dirty";
      assert.strictEqual(o1(), "one");
      order.push(4);
      Fiber.yield();
      order.push(5);
      assert.strictEqual(o1(), "one");
      order.push(6);
      o1.dirty();
      order.push(7);
      assert.strictEqual(o1(), "one:dirty");
      order.push(8);
      assert.strictEqual(o2(), "two:dirty");
      order.push(9);
    });

    result2 = "two"
    const o2 = wrap(function () {
      return result2;
    });

    order.push(0);

    f1.run();
    assert.deepEqual(order, [0, 1, 2]);

    // The primary goal of this test is to make sure this call to o2()
    // does not register a dirty-chain dependency for o1.
    assert.strictEqual(o2(), "two");

    f1.run();
    assert.deepEqual(order, [0, 1, 2, 3, 4]);

    // If the call to o2() captured o1() as a parent, then this o2.dirty()
    // call will report the o1() call dirty, which is not what we want.
    result2 += ":dirty";
    o2.dirty();

    f1.run();
    // The call to o1() between order.push(5) and order.push(6) should not
    // yield, because it should still be cached, because it should not be
    // dirty. However, the call to o1() between order.push(7) and
    // order.push(8) should yield, because we call o1.dirty() explicitly,
    // which is why this assertion stops at 7.
    assert.deepEqual(order, [0, 1, 2, 3, 4, 5, 6, 7]);

    f1.run();
    assert.deepEqual(order, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("marks evicted cache entries dirty", function () {
    let childSalt = "*";
    let child = wrap(function (x: string) {
      return x + childSalt;
    }, { max: 1 });

    let parentSalt = "^";
    const parent = wrap(function (x: string) {
      return child(x) + parentSalt;
    });

    assert.strictEqual(parent("asdf"), "asdf*^");

    childSalt = "&";
    parentSalt = "%";

    assert.strictEqual(parent("asdf"), "asdf*^");
    assert.strictEqual(child("zxcv"), "zxcv&");
    assert.strictEqual(parent("asdf"), "asdf&%");
  });

  it("handles children throwing exceptions", function () {
    const expected = new Error("oyez");

    const child = wrap(function () {
      throw expected;
    });

    const parent = wrap(function () {
      try {
        child();
      } catch (e) {
        return e;
      }
    });

    assert.strictEqual(parent(), expected);
    assert.strictEqual(parent(), expected);

    child.dirty();
    assert.strictEqual(parent(), expected);

    parent.dirty();
    assert.strictEqual(parent(), expected);
  });

  it("reports clean children to correct parents", function () {
    let childResult = "a";
    const child = wrap(function () {
      return childResult;
    });

    const parent = wrap(function (x: any) {
      return child() + x;
    });

    assert.strictEqual(parent(1), "a1");
    assert.strictEqual(parent(2), "a2");

    childResult = "b";
    child.dirty();

    // If this call to parent(1) mistakenly reports child() as clean to
    // parent(2), then the second assertion will fail by returning "a2".
    assert.strictEqual(parent(1), "b1");
    assert.strictEqual(parent(2), "b2");
  });

  it("supports object cache keys", function () {
    let counter = 0;
    const wrapped = wrap(function (a: any, b: any) {
      return counter++;
    });

    const a = {};
    const b = {};

    // Different combinations of distinct object references should
    // increment the counter.
    assert.strictEqual(wrapped(a, a), 0);
    assert.strictEqual(wrapped(a, b), 1);
    assert.strictEqual(wrapped(b, a), 2);
    assert.strictEqual(wrapped(b, b), 3);

    // But the same combinations of arguments should return the same
    // cached values when passed again.
    assert.strictEqual(wrapped(a, a), 0);
    assert.strictEqual(wrapped(a, b), 1);
    assert.strictEqual(wrapped(b, a), 2);
    assert.strictEqual(wrapped(b, b), 3);
  });

  it("detects problematic cycles", function () {
    const self: NumThunk = wrap(function () {
      return self() + 1;
    });

    const mutualA: NumThunk = wrap(function () {
      return mutualB() + 1;
    });

    const mutualB: NumThunk = wrap(function () {
      return mutualA() + 1;
    });

    function check(fn: typeof self) {
      try {
        fn();
        throw new Error("should not get here");
      } catch (e) {
        assert.strictEqual(e.message, "already recomputing");
      }

      // Try dirtying the function, now that there's a cycle in the Entry
      // graph. This should succeed.
      fn.dirty();
    }

    check(self);
    check(mutualA);
    check(mutualB);

    let returnZero = true;
    const fn: NumThunk = wrap(function () {
      if (returnZero) {
        returnZero = false;
        return 0;
      }
      returnZero = true;
      return fn() + 1;
    });

    assert.strictEqual(fn(), 0);
    assert.strictEqual(returnZero, false);

    returnZero = true;
    assert.strictEqual(fn(), 0);
    assert.strictEqual(returnZero, true);

    fn.dirty();

    returnZero = false;
    check(fn);
  });

  it("supports disposable wrapped functions", function () {
    let dependCallCount = 0;
    const depend = wrap(function (n?: number) {
      return ++dependCallCount;
    }, {
      disposable: true
    });

    assert.strictEqual(typeof depend(), "undefined");
    assert.strictEqual(dependCallCount, 0);

    let parentCallCount = 0;
    const parent = wrap(function () {
      ++parentCallCount;
      assert.strictEqual(typeof depend(1), "undefined");
      assert.strictEqual(typeof depend(2), "undefined");
    });

    parent();
    assert.strictEqual(parentCallCount, 1);
    assert.strictEqual(dependCallCount, 2);

    parent();
    assert.strictEqual(parentCallCount, 1);
    assert.strictEqual(dependCallCount, 2);

    depend.dirty(1);
    parent();
    assert.strictEqual(parentCallCount, 2);
    assert.strictEqual(dependCallCount, 3);

    depend.dirty(2);
    parent();
    assert.strictEqual(parentCallCount, 3);
    assert.strictEqual(dependCallCount, 4);

    parent();
    assert.strictEqual(parentCallCount, 3);
    assert.strictEqual(dependCallCount, 4);

    parent.dirty();
    parent();
    assert.strictEqual(parentCallCount, 4);
    assert.strictEqual(dependCallCount, 4);

    depend.dirty(1);
    depend(1);
    // No change to dependCallCount because depend is called outside of
    // any parent computation, and depend is disposable.
    assert.strictEqual(dependCallCount, 4);
    depend(2);
    assert.strictEqual(dependCallCount, 4);

    depend.dirty(2);
    depend(1);
    // Again, no change because depend is disposable.
    assert.strictEqual(dependCallCount, 4);
    depend(2);
    assert.strictEqual(dependCallCount, 4);

    parent();
    // Now, since both depend(1) and depend(2) are dirty, calling them in
    // the context of the parent() computation results in two more
    // increments of dependCallCount.
    assert.strictEqual(dependCallCount, 6);
  });

  it("is not confused by eviction during recomputation", function () {
    const fib: OptimisticWrapperFunction<[number], number> =
      wrap(function (n: number) {
        if (n > 1) {
          return fib(n - 1) + fib(n - 2);
        }
        return n;
      }, {
        max: 10
      });

    assert.strictEqual(fib(78), 8944394323791464);
    assert.strictEqual(fib(68), 72723460248141);
    assert.strictEqual(fib(58), 591286729879);
    assert.strictEqual(fib(48), 4807526976);
    assert.strictEqual(fib(38), 39088169);
    assert.strictEqual(fib(28), 317811);
    assert.strictEqual(fib(18), 2584);
    assert.strictEqual(fib(8),  21);
  });
});
