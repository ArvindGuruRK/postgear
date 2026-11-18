'use client';

/**
 * `usePreviewEngine`: one `PreviewEngine` for a component's life, drawn into
 * the element given to `containerRef`.
 *
 * - The engine is made in an effect, never during render (it makes `<video>`
 *   elements), so the first render has `engine: null`.
 * - Under StrictMode React mounts, unmounts and mounts again: the first
 *   engine is destroyed and a second one made, so no engine outlives its
 *   component and none is ever used after `destroy()`.
 * - The document and the address are handed over whenever they change; the
 *   engine keeps its playhead across both.
 *
 * The hook itself does not subscribe to the clock, so the component that
 * owns the stage does not re-render on every frame. Read the time through
 * `useSyncExternalStore(engine.subscribe, ...)` (the web app's
 * `PlaybackStore` does) in the small components that show it.
 */
import type { ClipDocument } from '@postgear/video-engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PreviewEngine, type PreviewEngineOptions } from './preview-engine';
import type { PreviewSource } from './types';

export interface UsePreviewEngineOptions extends Omit<PreviewEngineOptions, 'document' | 'source'> {
  document: ClipDocument | null;
  source: PreviewSource | null;
}

export interface UsePreviewEngine {
  /** Null on the first render, and between StrictMode's unmount and remount. */
  engine: PreviewEngine | null;
  /** Put on the element the stage fills (it should have the clip's shape). */
  containerRef: (element: HTMLElement | null) => void;
}

export function usePreviewEngine(options: UsePreviewEngineOptions): UsePreviewEngine {
  const [engine, setEngine] = useState<PreviewEngine | null>(null);
  const container = useRef<HTMLElement | null>(null);
  const live = useRef<PreviewEngine | null>(null);
  // Read once, when the engine is made: the layers and factories are fixed for its life.
  const creation = useRef(options);
  creation.current = options;

  useEffect(() => {
    const { document: _document, source: _source, ...fixed } = creation.current;
    const made = new PreviewEngine(fixed);
    live.current = made;
    if (container.current) {
      made.attach(container.current);
    }
    setEngine(made);
    return () => {
      made.destroy();
      if (live.current === made) {
        live.current = null;
      }
      setEngine((current) => (current === made ? null : current));
    };
  }, []);

  const { document: doc, source } = options;
  useEffect(() => {
    if (engine && doc) {
      engine.setDocument(doc);
    }
  }, [engine, doc]);

  const url = source?.url ?? null;
  const expiresAt = source?.expiresAt ?? null;
  const offsetMs = source?.offsetMs ?? 0;
  const fps = source?.fps ?? null;
  useEffect(() => {
    if (!engine) return;
    engine.setSource(url === null ? null : { url, expiresAt, offsetMs, fps });
  }, [engine, url, expiresAt, offsetMs, fps]);

  const containerRef = useCallback((element: HTMLElement | null) => {
    container.current = element;
    const current = live.current;
    if (!current || current.isDestroyed) return;
    if (element) {
      current.attach(element);
    } else {
      current.detach();
    }
  }, []);

  return { engine, containerRef };
}
