import { AnyEntry } from './entry';

type Context = {
  parent: Context | null;
  entry: AnyEntry | null;
}

let currentContext: Context | null = null;

export function getParentEntry() {
  return currentContext && currentContext.entry;
}

export function withEntry<TResult>(
  callback: () => TResult,
  entry: AnyEntry | null,
) {
  const parent = currentContext;
  currentContext = { parent, entry };
  try {
    return callback();
  } finally {
    currentContext = parent;
  }
}

// Immediately run a callback function without any captured context.
export function noContext<TResult>(callback: () => TResult) {
  return withEntry(callback, null);
}

// Capture the current context and wrap a callback function so that it
// reestablishes the captured context when called.
export function bindContext<TArgs extends any[], TResult>(
  callback: (...args: TArgs) => TResult,
) {
  const context = currentContext;
  return function (this: any) {
    const saved = currentContext;
    try {
      currentContext = context;
      return callback.apply(this, arguments as any);
    } finally {
      currentContext = saved;
    }
  } as typeof callback;
}

// Like global.setTimeout, except the callback runs with captured context.
export { setTimeoutWithContext as setTimeout };
function setTimeoutWithContext(callback: () => any, delay: number) {
  return setTimeout(bindContext(callback), delay);
}

function isPromiseLike(value: any): value is PromiseLike<any> {
  return value && typeof value.then === "function";
}

// Turn any generator function into an async function (using yield instead
// of await), with context automatically preserved across yields.
export function asyncFromGen<TArgs extends any[], TResult>(
  genFn: (...args: TArgs) => IterableIterator<TResult>,
) {
  return function (this: any) {
    const context = currentContext;
    const gen = genFn.apply(this, arguments as any);

    return new Promise((resolve, reject) => {
      function pump(valueToSend?: any) {
        const saved = currentContext;
        let result: IteratorResult<TResult | PromiseLike<TResult>>;
        try {
          currentContext = context;
          result = gen.next(valueToSend);
          currentContext = saved;
        } catch (error) {
          currentContext = saved;
          return reject(error);
        }
        const next = result.done ? resolve : pump;
        if (isPromiseLike(result.value)) {
          result.value.then(next, reject);
        } else {
          next(result.value);
        }
      }
      pump();
    });
  } as (...args: TArgs) => Promise<TResult>;
}
