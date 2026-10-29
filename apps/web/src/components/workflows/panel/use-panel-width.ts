'use client';

/**
 * The step panel's width (blueprint 3: 400 px, resizable 360 to 560),
 * remembered per browser. Storage is a convenience: a private window or
 * blocked site data just means the default each time.
 */
import { useEffect, useRef, useState } from 'react';
import { clamp } from './resize-handle';

export const PANEL_MIN = 360;
export const PANEL_MAX = 560;
export const PANEL_DEFAULT = 400;
export const PANEL_STEP = 16;
export const PANEL_WIDTH_KEY = 'postgear.workflows.panelWidth';

export function readPanelWidth(): number {
  try {
    const raw = window.localStorage.getItem(PANEL_WIDTH_KEY);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? clamp(Math.round(value), PANEL_MIN, PANEL_MAX) : PANEL_DEFAULT;
  } catch {
    return PANEL_DEFAULT;
  }
}

export function writePanelWidth(width: number): void {
  try {
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(width));
  } catch {
    // Remembering the width is a convenience only.
  }
}

export function usePanelWidth(): [number, (width: number) => void] {
  // The default on the server and the first paint; the stored width right after.
  const [width, setWidth] = useState(PANEL_DEFAULT);
  const loaded = useRef(false);

  useEffect(() => {
    setWidth(readPanelWidth());
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    const timer = setTimeout(() => writePanelWidth(width), 200);
    return () => clearTimeout(timer);
  }, [width]);

  return [width, (next) => setWidth(clamp(next, PANEL_MIN, PANEL_MAX))];
}
