'use client';

/**
 * What a card and a line need to know about the canvas they sit on
 * (Module 08), apart from the builder: whether anything may be edited, who
 * hears a click on a run's result badge, and the ids of this canvas's
 * arrowheads.
 *
 * The editor and the read-only run canvas both draw the same `StepCard` and
 * `StepEdge`; this is what tells them apart. Marker ids are per canvas
 * because two canvases can share a page (the Runs tab next to a hidden
 * editor), and a `url(#id)` that resolves into a hidden SVG draws nothing.
 */
import { createContext, useContext, useId } from 'react';

export interface CanvasMode {
  /** A run or a version preview: nothing can be moved, connected, deleted or edited. */
  readOnly: boolean;
  /** The base id of this canvas's arrowheads (`-error` and `-taken` follow it). */
  markerId: string;
  /** A step's result badge was clicked. */
  onRunBadgeClick?: (nodeKey: string) => void;
}

const DEFAULT_MODE: CanvasMode = { readOnly: false, markerId: 'pg-arrow' };

const CanvasModeContext = createContext<CanvasMode>(DEFAULT_MODE);

export const CanvasModeProvider = CanvasModeContext.Provider;

export function useCanvasMode(): CanvasMode {
  return useContext(CanvasModeContext);
}

/** A marker id unique to one canvas, safe inside `url(#...)`. */
export function useMarkerId(): string {
  return `pg-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}
