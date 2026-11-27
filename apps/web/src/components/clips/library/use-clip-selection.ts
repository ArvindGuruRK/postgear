'use client';

/**
 * The Clips tab's ticked clips (Module 11, section 1). Page state only: a
 * filter change clears it, and a clip that leaves the list (hidden, deleted)
 * leaves the selection with it.
 *
 * A Shift-click ticks (or unticks) every clip between the last one clicked
 * and this one, in the order the list shows them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * The ids ticked after a click on `id`. With `range` and a known `anchor`,
 * every clip from the anchor to `id` takes the clicked clip's new state.
 */
export function nextSelection(
  current: ReadonlySet<string>,
  order: readonly string[],
  id: string,
  options: { range: boolean; anchor: string | null },
): Set<string> {
  const next = new Set(current);
  const on = !current.has(id);
  const from = options.anchor === null ? -1 : order.indexOf(options.anchor);
  const to = order.indexOf(id);
  if (options.range && from !== -1 && to !== -1) {
    const [low, high] = from < to ? [from, to] : [to, from];
    for (const one of order.slice(low, high + 1)) {
      if (on) next.add(one);
      else next.delete(one);
    }
    return next;
  }
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

export interface ClipSelection {
  /** The ticked ids that are still on the list, in the list's order. */
  ids: string[];
  count: number;
  isTicked: (id: string) => boolean;
  /** A click on a tick box; `range` when Shift was held. */
  toggle: (id: string, range: boolean) => void;
  /** Ticks every clip on the list, or clears them when all are ticked. */
  toggleAll: () => void;
  clear: () => void;
}

export function useClipSelection(order: readonly string[], resetKey: string): ClipSelection {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);

  // A filter change starts again.
  useEffect(() => {
    void resetKey;
    setTicked(new Set());
    anchor.current = null;
  }, [resetKey]);

  const ids = useMemo(() => order.filter((id) => ticked.has(id)), [order, ticked]);
  const orderRef = useRef(order);
  orderRef.current = order;

  const toggle = useCallback((id: string, range: boolean) => {
    setTicked((current) =>
      nextSelection(current, orderRef.current, id, { range, anchor: anchor.current }),
    );
    anchor.current = id;
  }, []);

  const clear = useCallback(() => {
    setTicked(new Set());
    anchor.current = null;
  }, []);

  const allTicked = order.length > 0 && ids.length === order.length;
  const toggleAll = useCallback(() => {
    setTicked(allTicked ? new Set() : new Set(orderRef.current));
    anchor.current = null;
  }, [allTicked]);

  const isTicked = useCallback((id: string) => ticked.has(id), [ticked]);

  return { ids, count: ids.length, isTicked, toggle, toggleAll, clear };
}
