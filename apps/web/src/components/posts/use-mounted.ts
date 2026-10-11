'use client';

import { useEffect, useState } from 'react';

/**
 * True after the first client render.
 *
 * The calendar and the queue format every time in the viewer's locale and time
 * zone, which the server does not share: a Node process in UTC renders "12 am"
 * where the browser renders "0:00", and React then reports a hydration
 * mismatch and re-renders the tree. Anything locale-dependent waits for this
 * flag and renders a skeleton on the server instead.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
}
