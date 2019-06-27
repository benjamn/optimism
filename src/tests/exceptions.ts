import * as assert from "assert";
import { wrap } from "..";

describe("exceptions", function () {
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
});
