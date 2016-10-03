"use strict";

var fakeNullFiber = function Fiber(){};
var localKey = "_optimism_local";

function getCurrentFiber() {
  return fakeNullFiber;
}

try {
  var fiberPath = require.resolve("fibers");
} catch (e) {}

if (fiberPath) {
  var Fiber = require(fiberPath);

  // If we were able to require("fibers"), redefine the getCurrentFiber
  // function so that it has a chance to return Fiber.current.
  getCurrentFiber = function () {
    return Fiber.current || fakeNullFiber;
  };
}

// Returns an object unique to Fiber.current, if fibers are enabled.
// This object is used for Fiber-local storage in ./entry.js.
exports.get = function () {
  var fiber = getCurrentFiber();
  return fiber[localKey] || (fiber[localKey] = Object.create(null));
};
