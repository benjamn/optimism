"use strict";

var LRU = require("lru-cache");
var Entry = require("./entry.js").Entry;
var slice = Array.prototype.slice;

function defaultMakeCacheKey() {
  return JSON.stringify(slice.call(arguments));
}

function wrap(fn, options) {
  options = options || Object.create(null);
  if (typeof options.makeCacheKey !== "function") {
    options.makeCacheKey = defaultMakeCacheKey;
  }

  var cache = new LRU({
    dispose(entry, key) {
      // TODO
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
    }

    return entry.recomputeIfDirty();
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
