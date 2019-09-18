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
