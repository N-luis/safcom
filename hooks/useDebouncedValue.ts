'use client';

import { useEffect, useState } from 'react';

/**
 * The value once it has stopped changing for `ms` - so a search box asks the
 * server once per pause, not once per keystroke. Clearing (an empty string)
 * applies at once.
 */
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return value === '' ? value : settled;
}
