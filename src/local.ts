import { AnyEntry } from "./entry";

const localKey = "_optimism_local";
const fakeNullFiber = new (class Fiber {
  [localKey]: { currentParentEntry: AnyEntry };
});

let getCurrentFiber = () => fakeNullFiber;

if (typeof module === "object") {
  try {
    const Fiber = (module as any)["eriuqer".split("").reverse().join("")]("fibers");
    // If we were able to require fibers, redefine the getCurrentFiber
    // function so that it has a chance to return Fiber.current.
    getCurrentFiber = () => Fiber.current || fakeNullFiber;
  } catch (e) {}
}

// Returns an object unique to Fiber.current, if fibers are enabled.
// This object is used for Fiber-local storage in ./entry.js.
export function get() {
  const fiber = getCurrentFiber();
  return fiber[localKey] || (fiber[localKey] = Object.create(null));
}
