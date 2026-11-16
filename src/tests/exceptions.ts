import * as assert from "assert";
import { wrap } from "../index.js";

describe("exceptions", function () {
  it("should retry after a native stack overflow and then cache the result", function () {
    function overflow(): never {
      return overflow();
    }
    let shouldOverflow = true;
    let calls = 0;
    const result = {};
    const wrapper = wrap(() => {
      ++calls;
      return shouldOverflow ? overflow() : result;
    });

    assert.throws(wrapper, (error: unknown) =>
      error instanceof RangeError &&
      error.message === "Maximum call stack size exceeded"
    );
    shouldOverflow = false;
    assert.strictEqual(wrapper(), result);
    assert.strictEqual(wrapper(), result);
    assert.strictEqual(calls, 2);
  });

  it("should retry a parent's fallback after a dirty child overflows", function () {
    let state = "initial";
    const child = wrap(() => {
      if (state === "overflow") {
        throw new RangeError("Maximum call stack size exceeded");
      }
      return state;
    });
    const middle = wrap(() => child());
    const parent = wrap(() => {
      try {
        return middle();
      } catch {
        return "fallback";
      }
    });

    assert.strictEqual(parent(), "initial");
    state = "overflow";
    child.dirty();
    assert.strictEqual(parent(), "fallback");
    state = "recovered";
    assert.strictEqual(parent(), "recovered");
    assert.strictEqual(parent(), "recovered");
  });

  it("should preserve ordinary thrown values even when inspecting them throws", function () {
    const messageGetterError = new RangeError();
    Object.defineProperty(messageGetterError, "message", {
      get() { throw new Error("message getter"); },
    });
    const prototypeGetterError = new Proxy({}, {
      getPrototypeOf() { throw new Error("prototype getter"); },
    });
    const errors = [
      new Error("Maximum call stack size exceeded"),
      new RangeError("ordinary range error"),
      messageGetterError,
      prototypeGetterError,
      undefined,
      null,
      0,
    ];
    errors.forEach(error => {
      let calls = 0;
      const wrapper = wrap(() => {
        ++calls;
        throw error;
      });
      function check() {
        try {
          wrapper();
          assert.fail("expected the original thrown value");
        } catch (actual) {
          assert.strictEqual(actual, error);
        }
      }
      check();
      check();
      assert.strictEqual(calls, 1);
      wrapper.dirty();
      check();
      assert.strictEqual(calls, 2);
    });
  });

  it("should clean up subscriptions when retrying and forgetting overflowed entries", function () {
    let shouldOverflow = true;
    let activeSubscriptions = 0;
    let calls = 0;
    const wrapper = wrap(() => {
      ++calls;
      if (shouldOverflow) {
        throw new RangeError("Maximum call stack size exceeded");
      }
      return "recovered";
    }, {
      subscribe() {
        ++activeSubscriptions;
        return () => --activeSubscriptions;
      },
    });

    assert.throws(wrapper, RangeError);
    assert.throws(wrapper, RangeError);
    assert.strictEqual(calls, 2);
    assert.strictEqual(activeSubscriptions, 1);
    shouldOverflow = false;
    assert.strictEqual(wrapper(), "recovered");
    assert.strictEqual(wrapper(), "recovered");
    assert.strictEqual(calls, 3);
    wrapper.forget();
    assert.strictEqual(activeSubscriptions, 0);
  });

  it("should be cached", function () {
    const error = new Error("expected");
    let threw = false;
    function throwOnce() {
      if (!threw) {
        threw = true;
        throw error;
      }
      return "already threw";
    }

    const wrapper = wrap(throwOnce);

    try {
      wrapper();
      throw new Error("unreached");
    } catch (e) {
      assert.strictEqual(e, error);
    }

    try {
      wrapper();
      throw new Error("unreached");
    } catch (e) {
      assert.strictEqual(e, error);
    }

    wrapper.dirty();
    assert.strictEqual(wrapper(), "already threw");
    assert.strictEqual(wrapper(), "already threw");
    wrapper.dirty();
    assert.strictEqual(wrapper(), "already threw");
  });

  it("should memoize a throwing fibonacci function", function () {
    const fib = wrap((n: number) => {
      if (n < 2) throw n;
      try {
        fib(n - 1);
      } catch (minusOne: any) {
        try {
          fib(n - 2);
        } catch (minusTwo: any) {
          throw minusOne + minusTwo;
        }
      }
      throw new Error("unreached");
    });

    function check(n: number, expected: number) {
      try {
        fib(n);
        throw new Error("unreached");
      } catch (result) {
        assert.strictEqual(result, expected);
      }
    }

    check(78, 8944394323791464);
    check(68, 72723460248141);
    check(58, 591286729879);
    check(48, 4807526976);
    fib.dirty(28);
    check(38, 39088169);
    check(28, 317811);
    check(18, 2584);
    check(8,  21);
    fib.dirty(20);
    check(78, 8944394323791464);
    check(10, 55);
  });
});
