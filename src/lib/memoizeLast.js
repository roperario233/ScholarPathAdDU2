// Remembers the most recent call. Selectors that derive a list from large server
// collections use it so an unrelated state change returns the same array (and so
// keeps every downstream memo valid) instead of re-filtering on each render.
// One cache slot is enough: the app renders a single workspace at a time.
export const memoizeLast = (compute) => {
  let lastArgs = null;
  let lastResult;
  return (...args) => {
    if (lastArgs && lastArgs.length === args.length && args.every((arg, index) => Object.is(arg, lastArgs[index]))) {
      return lastResult;
    }
    lastResult = compute(...args);
    lastArgs = args;
    return lastResult;
  };
};
