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
      makeCacheKey(x) {
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
});
