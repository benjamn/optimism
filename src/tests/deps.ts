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

  it("supports subscribing and unsubscribing", function () {
    let subscribeCallCount = 0;
    let unsubscribeCallCount = 0;
    let parentCallCount = 0;

    function check(counts: {
      subscribe: number;
      unsubscribe: number;
      parent: number;
    }) {
      assert.strictEqual(counts.subscribe, subscribeCallCount);
      assert.strictEqual(counts.unsubscribe, unsubscribeCallCount);
      assert.strictEqual(counts.parent, parentCallCount);
    }

    const d = dep({
      subscribe(key: string) {
        ++subscribeCallCount;
        return () => {
          ++unsubscribeCallCount;
        };
      },
    });

    assert.strictEqual(subscribeCallCount, 0);
    assert.strictEqual(unsubscribeCallCount, 0);

    const parent = wrap((key: string) => {
      d(key);
      return ++parentCallCount;
    });

    assert.strictEqual(parent("rawr"), 1);
    check({ subscribe: 1, unsubscribe: 0, parent: 1 });
    assert.strictEqual(parent("rawr"), 1);
    check({ subscribe: 1, unsubscribe: 0, parent: 1 });
    assert.strictEqual(parent("blep"), 2);
    check({ subscribe: 2, unsubscribe: 0, parent: 2 });
    assert.strictEqual(parent("rawr"), 1);
    check({ subscribe: 2, unsubscribe: 0, parent: 2 });
    assert.strictEqual(parent("blep"), 2);
    check({ subscribe: 2, unsubscribe: 0, parent: 2 });

    d.dirty("blep");
    check({ subscribe: 2, unsubscribe: 1, parent: 2 });
    assert.strictEqual(parent("rawr"), 1);
    check({ subscribe: 2, unsubscribe: 1, parent: 2 });
    d.dirty("blep"); // intentionally redundant
    check({ subscribe: 2, unsubscribe: 1, parent: 2 });
    assert.strictEqual(parent("blep"), 3);
    check({ subscribe: 3, unsubscribe: 1, parent: 3 });
    assert.strictEqual(parent("blep"), 3);
    check({ subscribe: 3, unsubscribe: 1, parent: 3 });

    d.dirty("rawr");
    check({ subscribe: 3, unsubscribe: 2, parent: 3 });
    assert.strictEqual(parent("blep"), 3);
    check({ subscribe: 3, unsubscribe: 2, parent: 3 });
    assert.strictEqual(parent("rawr"), 4);
    check({ subscribe: 4, unsubscribe: 2, parent: 4 });
    assert.strictEqual(parent("blep"), 3);
    check({ subscribe: 4, unsubscribe: 2, parent: 4 });
  });

  describe("cleanup", () => {
    it("cleans up correctly on LRU eviction", () => {
      let subscribeFooCount = 0;
      let unsubscribeFooCount = 0;
      let parentCallCount = 0;

      const d = dep({
        subscribe(key: string) {
          if (key !== "foo") return;

          ++subscribeFooCount;
          return () => {
            ++unsubscribeFooCount;
          };
        },
      });

      const lruCacheMaxSize = 1;

      const parent = wrap((key: string) => {
        d(key);
        return ++parentCallCount;
      }, { max: lruCacheMaxSize });

      parent("foo");
      parent("foo");
      parent("bar"); // trigger LRU eviction of "foo" (expecting unsubscribe here)

      assert.strictEqual(subscribeFooCount, 1);
      assert.strictEqual(unsubscribeFooCount, 1);
      assert.strictEqual(d.keyCount(), 1);
    });

    it("cleans up after being marked as dirty", () => {
      let subscribeCallCount = 0;
      let unsubscribeCallCount = 0;
      let parent1CallCount = 0;
      let parent2CallCount = 0;

      const parent1 = wrap((key: string) => {
        d(key);
        return parent1CallCount++;
      });

      const parent2 = wrap((key: string) => {
        d(key);
        return parent2CallCount++;
      });

      const d = dep({
        subscribe(_: string) {
          ++subscribeCallCount
          return () => {
            ++unsubscribeCallCount;
          };
        },
      });

      parent1("foo");
      parent2("foo");
      assert.strictEqual(subscribeCallCount, 2);
      assert.strictEqual(unsubscribeCallCount, 1);
      assert.strictEqual(d.keyCount(), 1);

      d.dirty("foo");
      assert.strictEqual(subscribeCallCount, 2);
      assert.strictEqual(unsubscribeCallCount, 2);
      assert.strictEqual(d.keyCount(), 0);

      parent1("foo");
      assert.strictEqual(subscribeCallCount, 3);
      assert.strictEqual(unsubscribeCallCount, 2);
      assert.strictEqual(d.keyCount(), 1);

      parent2("foo");
      assert.strictEqual(subscribeCallCount, 4);
      assert.strictEqual(unsubscribeCallCount, 3);
      assert.strictEqual(d.keyCount(), 1);

      d.dirty("foo");
      assert.strictEqual(subscribeCallCount, 4);
      assert.strictEqual(unsubscribeCallCount, 4);
      assert.strictEqual(d.keyCount(), 0);
    });

    it("cleans up unused keys on recompute", () => {
      let subscribeFirstCount = 0;
      let unsubscribeFirstCount = 0;
      let firstCall = true;

      const d = dep({
        subscribe(key: string) {
          if (key !== "first") return;

          ++subscribeFirstCount
          return () => {
            ++unsubscribeFirstCount;
          };
        },
      });

      const parent = wrap((key: string) => {
        if (firstCall) {
          d("first");
          firstCall = false;
        }
        d(key);
        return key;
      });

      parent("foo");
      assert.strictEqual(subscribeFirstCount, 1);
      assert.strictEqual(unsubscribeFirstCount, 0);
      assert.strictEqual(d.keyCount(), 2); // "first", "foo"

      d.dirty("foo");
      assert.strictEqual(subscribeFirstCount, 1);
      assert.strictEqual(unsubscribeFirstCount, 0);
      assert.strictEqual(d.keyCount(), 1); // "first"

      parent("foo");
      assert.strictEqual(subscribeFirstCount, 1);
      assert.strictEqual(unsubscribeFirstCount, 1);
      assert.strictEqual(d.keyCount(), 1); // "foo"

      d.dirty("foo")
      assert.strictEqual(subscribeFirstCount, 1);
      assert.strictEqual(unsubscribeFirstCount, 1);
      assert.strictEqual(d.keyCount(), 0);
    });

    it("cleans up on LRU eviction after being marked as dirty", () => {
      type Keys = "foo" | "bar";
      const subscribeCalls = { foo: 0, bar: 0 };
      const unsubscribeCalls = { foo: 0, bar: 0 };
      const calls = { foo: 0, bar: 0 };

      const lruCacheMaxSize = 1;

      const parent1 = wrap((key: Keys) => {
        d(key);
        return calls[key]++;
      }, { max: lruCacheMaxSize });

      const parent2 = wrap((key: Keys) => {
        d(key);
        return calls[key]++;
      });

      const d = dep({
        subscribe(key: Keys) {
          subscribeCalls[key]++
          return () => {
            unsubscribeCalls[key]++;
          };
        },
      });

      parent1("foo");
      d.dirty("foo");
      parent2("foo");
      assert.strictEqual(subscribeCalls.foo, 2);
      assert.strictEqual(unsubscribeCalls.foo, 1);
      assert.strictEqual(d.keyCount(), 1);

      parent1("bar"); // trigger LRU eviction of "foo" from parent1
      assert.strictEqual(subscribeCalls.foo, 2);
      assert.strictEqual(unsubscribeCalls.foo, 1); // parent2 still depends on "foo"
      assert.strictEqual(d.keyCount(), 2); // foo (for parent2), bar (for parent1)
    });
  })
});
