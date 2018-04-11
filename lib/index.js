"use strict";

var LRU = require("lru-cache");
var Entry = require("./entry.js").Entry;
var slice = Array.prototype.slice;

function defaultMakeCacheKey() {
  return JSON.stringify(slice.call(arguments));
}

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

    var args = slice.call(arguments);
    var entry = cache.get(key);
    if (entry) {
      entry.args = args;
    } else {
      cache.set(key, entry = new Entry(fn, key, args));
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
