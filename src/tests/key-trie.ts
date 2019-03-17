import * as assert from "assert";
import { KeyTrie } from "../index";

describe("KeyTrie", function () {
  it("can be imported", function () {
    assert.strictEqual(typeof KeyTrie, "function");
  });

  it("can hold objects weakly", function () {
    const trie = new KeyTrie<object>(true);
    assert.strictEqual((trie as any).weakness, true);
    const obj1 = {};
    assert.strictEqual(
      trie.lookup(obj1, 2, 3),
      trie.lookup(obj1, 2, 3),
    );
    const obj2 = {};
    assert.notStrictEqual(
      trie.lookup(1, obj2),
      trie.lookup(1, obj2, 3),
    );
    assert.strictEqual((trie as any).weak.has(obj1), true);
    assert.strictEqual((trie as any).strong.has(obj1), false);
    assert.strictEqual((trie as any).strong.get(1).weak.has(obj2), true);
    assert.strictEqual((trie as any).strong.get(1).weak.get(obj2).strong.has(3), true);
  });

  it("can disable WeakMap", function () {
    const trie = new KeyTrie<object>(false);
    assert.strictEqual((trie as any).weakness, false);
    const obj1 = {};
    assert.strictEqual(
      trie.lookup(obj1, 2, 3),
      trie.lookup(obj1, 2, 3),
    );
    const obj2 = {};
    assert.notStrictEqual(
      trie.lookup(1, obj2),
      trie.lookup(1, obj2, 3),
    );
    assert.strictEqual(typeof (trie as any).weak, "undefined");
    assert.strictEqual((trie as any).strong.has(obj1), true);
    assert.strictEqual((trie as any).strong.has(1), true);
    assert.strictEqual((trie as any).strong.get(1).strong.has(obj2), true);
    assert.strictEqual((trie as any).strong.get(1).strong.get(obj2).strong.has(3), true);
  });
});
