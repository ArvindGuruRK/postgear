'use client';

/**
 * Publishes the canvas zoom as `--pg-zoom` on React Flow's wrapper, so the CSS
 * can keep a line the same width on screen at every zoom (a card's selection
 * and hover rings: a 3px outline scaled with the canvas is under a pixel at
 * 20% and the card looked unselectable). It writes the property straight to the
 * element from the store, so a wheel tick re-renders nothing.
 */
import { type ReactFlowState, useStoreApi } from '@xyflow/react';
import { useEffect } from 'react';

export function ZoomVar() {
  const store = useStoreApi();
  useEffect(() => {
    let last = -1;
    const apply = (state: ReactFlowState) => {
      const zoom = state.transform[2];
      if (zoom === last || !state.domNode) return;
      last = zoom;
      state.domNode.style.setProperty('--pg-zoom', String(zoom));
    };
    apply(store.getState());
    return store.subscribe(apply);
  }, [store]);
  return null;
}
