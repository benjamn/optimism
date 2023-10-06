import * as assert from "assert";
import { WeakCache } from "../weakCache";

describe("weak least-recently-used cache", function () {
  it("can hold lots of elements", function () {
    const cache = new WeakCache();
    const count = 1000000;
    const keys = [];

    for (let i = 0; i < count; ++i) {
      const key = {};
      cache.set(key, String(i));
      keys[i] = key;
    }

    cache.clean();

    assert.strictEqual(cache.size, count);
    assert.ok(cache.has(keys[0]));
    assert.ok(cache.has(keys[count - 1]));
    assert.strictEqual(cache.get(keys[43]), "43");
  });

  it("evicts excess old elements", function () {
    const max = 10;
    const evicted = [];
    const cache = new WeakCache(max, (value, key) => {
      assert.strictEqual(key.valueOf(), value.valueOf());
      evicted.push(key);
    });

    const count = 100;
    const keys = [];
    for (let i = 0; i < count; ++i) {
      const key = new String(i);
      cache.set(key, String(i));
      keys[i] = key;
    }

    cache.clean();

    assert.strictEqual((cache as any).size, max);
    assert.strictEqual(evicted.length, count - max);

    for (let i = count - max; i < count; ++i) {
      assert.ok(cache.has(keys[i]));
    }
  });

  it("can cope with small max values", function () {
    const cache = new WeakCache(2);
    const keys = Array(10)
      .fill(null)
      .map((_, i) => new Number(i));

    function check(...sequence: number[]) {
      cache.clean();

      let entry = (cache as any).newest;
      const forwards = [];
      while (entry) {
        forwards.push(entry.keyRef.deref());
        entry = entry.older;
      }
      assert.deepEqual(forwards.map(Number), sequence);

      const backwards = [];
      entry = (cache as any).oldest;
      while (entry) {
        backwards.push(entry.keyRef.deref());
        entry = entry.newer;
      }
      backwards.reverse();
      assert.deepEqual(backwards.map(Number), sequence);

      sequence.forEach(function (n) {
        assert.strictEqual((cache as any).map.get(keys[n]).value, n + 1);
      });

      if (sequence.length > 0) {
        assert.strictEqual((cache as any).newest.keyRef.deref().valueOf(), sequence[0]);
        assert.strictEqual(
          (cache as any).oldest.keyRef.deref().valueOf(),
          sequence[sequence.length - 1]
        );
      }
    }

    cache.set(keys[1], 2);
    check(1);

    cache.set(keys[2], 3);
    check(2, 1);

    cache.set(keys[3], 4);
    check(3, 2);

    cache.get(keys[2]);
    check(2, 3);

    cache.set(keys[4], 5);
    check(4, 2);

    assert.strictEqual(cache.has(keys[1]), false);
    assert.strictEqual(cache.get(keys[2]), 3);
    assert.strictEqual(cache.has(keys[3]), false);
    assert.strictEqual(cache.get(keys[4]), 5);

    cache.delete(keys[2]);
    check(4);
    cache.delete(keys[4]);
    check();

    assert.strictEqual((cache as any).newest, null);
    assert.strictEqual((cache as any).oldest, null);
  });
});
