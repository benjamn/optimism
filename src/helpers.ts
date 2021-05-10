export const {
  hasOwnProperty,
} = Object.prototype;

export const {
  // This Array.from polyfill is restricted to working with Set<any> for now,
  // but we can improve the polyfill and add other input types, as needed. Note
  // that this fallback implementation will only be used if the host environment
  // does not support a native Array.from function. In most modern JS runtimes,
  // the toArray function exported here will be === Array.from.
  from: toArray = (collection: Set<any>) => {
    const array: any[] = [];
    collection.forEach(item => array.push(item));
    return array;
  },
} = Array;

export type Unsubscribable = {
  unsubscribe?: void | (() => any);
}

export function maybeUnsubscribe(entryOrDep: Unsubscribable) {
  const { unsubscribe } = entryOrDep;
  if (typeof unsubscribe === "function") {
    entryOrDep.unsubscribe = void 0;
    unsubscribe();
  }
}
