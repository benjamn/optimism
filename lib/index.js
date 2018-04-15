"use strict";

var LRU = require("lru-cache");
var tuple = require("immutable-tuple").tuple;
var Entry = require("./entry.js").Entry;

function defaultMakeCacheKey() {
  return tuple.apply(null, arguments);
}

// Exported so that custom makeCacheKey functions can easily reuse the
// default implementation (with different arguments).
exports.defaultMakeCacheKey = defaultMakeCacheKey;

function normalizeOptions(options) {
  options = options || Object.create(null);

  if (typeof options.makeCacheKey !== "function") {
    options.makeCacheKey = defaultMakeCacheKey;
  }

  if (typeof options.max !== "number") {
    options.max = Math.pow(2, 16);
  }

  return options;
}

function wrap(fn, options) {
  options = normalizeOptions(options);

  var cache = new LRU({
    max: options.max,
    dispose: function (key, entry) {
      entry.dispose();
    }
  });

  function optimistic() {
    var key = options.makeCacheKey.apply(null, arguments);
    if (! key) {
      return fn.apply(null, arguments);
    }

    var args = [], len = arguments.length;
    while (len--) args[len] = arguments[len];

    var entry = cache.get(key);
    if (entry) {
      entry.args = args;
    } else {
      cache.set(key, entry = new Entry(fn, args));
      entry.subscribe = options.subscribe;
    }

    return entry.recompute();
  }

  optimistic.dirty = function () {
    var key = options.makeCacheKey.apply(null, arguments);
    if (! key) {
      return;
    }

    if (! cache.has(key)) {
      return;
    }

    cache.get(key).setDirty();
  };

  return optimistic;
}

exports.wrap = wrap;
