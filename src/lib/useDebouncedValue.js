import { useEffect, useState } from 'react';

// Returns `value` after it has stopped changing for `delayMs`. The input that
// produces it stays responsive (it reads the live value); the expensive work that
// consumes the settled value (filtering a thousand cases, a server query) runs
// once the typing pauses instead of on every keystroke.
export const useDebouncedValue = (value, delayMs = 250) => {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
};
