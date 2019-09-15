import * as assert from "assert";
import { createHash } from "crypto";
import {
  wrap,
  defaultMakeCacheKey,
  OptimisticWrapperFunction,
} from "../index";
import { wrapYieldingFiberMethods } from '@wry/context';

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
    const Fiber = wrapYieldingFiberMethods(require("fibers"));

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

  it("supports falsy non-void cache keys", function () {
    let callCount = 0;
    const wrapped = wrap((key: number | string | null | boolean | undefined) => {
      ++callCount;
      return key;
    }, {
      makeCacheKey(key) {
        return key;
      },
    });

    assert.strictEqual(wrapped(0), 0);
    assert.strictEqual(callCount, 1);
    assert.strictEqual(wrapped(0), 0);
    assert.strictEqual(callCount, 1);

    assert.strictEqual(wrapped(""), "");
    assert.strictEqual(callCount, 2);
    assert.strictEqual(wrapped(""), "");
    assert.strictEqual(callCount, 2);

    assert.strictEqual(wrapped(null), null);
    assert.strictEqual(callCount, 3);
    assert.strictEqual(wrapped(null), null);
    assert.strictEqual(callCount, 3);

    assert.strictEqual(wrapped(false), false);
    assert.strictEqual(callCount, 4);
    assert.strictEqual(wrapped(false), false);
    assert.strictEqual(callCount, 4);

    assert.strictEqual(wrapped(0), 0);
    assert.strictEqual(wrapped(""), "");
    assert.strictEqual(wrapped(null), null);
    assert.strictEqual(wrapped(false), false);
    assert.strictEqual(callCount, 4);

    assert.strictEqual(wrapped(1), 1);
    assert.strictEqual(wrapped("oyez"), "oyez");
    assert.strictEqual(wrapped(true), true);
    assert.strictEqual(callCount, 7);

    assert.strictEqual(wrapped(void 0), void 0);
    assert.strictEqual(wrapped(void 0), void 0);
    assert.strictEqual(wrapped(void 0), void 0);
    assert.strictEqual(callCount, 10);
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

  it("tolerates misbehaving makeCacheKey functions", function () {
    type NumNum = OptimisticWrapperFunction<[number], number>;

    let chaos = false;
    let counter = 0;
    const allOddsDep = wrap(() => ++counter);

    const sumOdd: NumNum = wrap((n: number) => {
      allOddsDep();
      if (n < 1) return 0;
      if (n % 2 === 1) {
        return n + sumEven(n - 1);
      }
      return sumEven(n);
    }, {
      makeCacheKey(n) {
        // Even though the computation completes, returning "constant" causes
        // cycles in the Entry graph.
        return chaos ? "constant" : n;
      }
    });

    const sumEven: NumNum = wrap((n: number) => {
      if (n < 1) return 0;
      if (n % 2 === 0) {
        return n + sumOdd(n - 1);
      }
      return sumOdd(n);
    });

    function check() {
      sumEven.dirty(10);
      sumOdd.dirty(10);
      if (chaos) {
        try {
          sumOdd(10);
        } catch (e) {
          assert.strictEqual(e.message, "already recomputing");
        }
        try {
          sumEven(10);
        } catch (e) {
          assert.strictEqual(e.message, "already recomputing");
        }
      } else {
        assert.strictEqual(sumEven(10), 55);
        assert.strictEqual(sumOdd(10), 55);
      }
    }

    check();

    allOddsDep.dirty();
    sumEven.dirty(10);
    check();

    allOddsDep.dirty();
    allOddsDep();
    check();

    chaos = true;
    check();

    allOddsDep.dirty();
    allOddsDep();
    check();

    allOddsDep.dirty();
    check();

    chaos = false;
    allOddsDep.dirty();
    check();

    chaos = true;
    sumOdd.dirty(9);
    sumOdd.dirty(7);
    sumOdd.dirty(5);
    check();

    chaos = false;
    check();
  });

  it("tolerates cycles when propagating dirty/clean signals", function () {
    let counter = 0;
    const dep = wrap(() => ++counter);

    const callChild = () => child();
    let parentBody = callChild;
    const parent = wrap(() => {
      dep();
      return parentBody();
    });

    const callParent = () => parent();
    let childBody = () => "child";
    const child = wrap(() => {
      dep();
      return childBody();
    });

    assert.strictEqual(parent(), "child");

    childBody = callParent;
    parentBody = () => "parent";
    child.dirty();
    assert.strictEqual(child(), "parent");
    dep.dirty();
    assert.strictEqual(child(), "parent");
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
