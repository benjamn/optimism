var assert = require("assert");
var crypto = require("crypto");
var wrap = require("../lib/index.js").wrap;

describe("optimism", function () {
  it("sanity", function () {
    assert.strictEqual(typeof wrap, "function");
  });

  it("works with single functions", function () {
    var test = wrap(function (x) {
      return x + salt;
    }, {
      makeCacheKey: function (x) {
        return x;
      }
    });

    var salt = "salt";
    assert.strictEqual(test("a"), "asalt");

    salt = "NaCl";
    assert.strictEqual(test("a"), "asalt");
    assert.strictEqual(test("b"), "bNaCl");

    test.dirty("a");
    assert.strictEqual(test("a"), "aNaCl");
  });

  it("works with two layers of functions", function () {
    var files = {
      "a.js": new Buffer("ay"),
      "b.js": new Buffer("bee")
    };

    var read = wrap(function (path) {
      return files[path];
    });

    var hash = wrap(function (paths) {
      var h = crypto.createHash("sha1");
      paths.forEach(function (path) {
        h.update(read(path));
      });
      return h.digest("hex");
    });

    var hash1 = hash(["a.js", "b.js"]);
    files["a.js"] += "yy";
    var hash2 = hash(["a.js", "b.js"]);
    read.dirty("a.js");
    var hash3 = hash(["a.js", "b.js"]);

    assert.strictEqual(hash1, hash2);
    assert.notStrictEqual(hash1, hash3);
  });

  it("works with subscription functions", function () {
    var dirty;
    var sep = ",";
    var unsubscribed = Object.create(null);
    var test = wrap(function (x) {
      return [x, x, x].join(sep);
    }, {
      max: 1,
      subscribe: function (x) {
        dirty = function () {
          test.dirty(x);
        };

        return function () {
          assert.strictEqual(this, test);
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

    dirty();

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
    var Fiber = require("fibers");
    var order = [];
    var result1 = "one";
    var result2 = "two";

    var f1 = new Fiber(function () {
      order.push(1);

      var o1 = wrap(function () {
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

    var result2 = "two"
    var o2 = wrap(function () {
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
});
