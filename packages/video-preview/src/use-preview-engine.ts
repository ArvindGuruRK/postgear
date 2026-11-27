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
 * - The document and the addresses are handed over whenever they change;
 *   the engine keeps its playhead across them. The other videos' addresses
 *   (`extraSources`, Module 10) go in before the main one, so a clip that
 *   opens on a brand intro seeks the intro's own video from the start. They
 *   are compared by their contents, so a map made anew on every render does
 *   not reload anything.
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

export interface UsePreviewEngineOptions
  extends Omit<PreviewEngineOptions, 'document' | 'source' | 'extraSources'> {
  document: ClipDocument | null;
  source: PreviewSource | null;
  /** The document's other videos, by source id (`PreviewEngine.setExtraSources`). */
  extraSources?: Readonly<Record<string, PreviewSource | null>> | null;
}

type ExtraEntry = [id: string, source: PreviewSource | null];

/** The map's contents as one string, in key order, so an equal map made again changes nothing. */
function extraSourcesKey(sources: UsePreviewEngineOptions['extraSources']): string {
  const entries: ExtraEntry[] = Object.keys(sources ?? {})
    .sort()
    .map((id) => {
      const source = sources?.[id] ?? null;
      return [
        id,
        source
          ? {
              url: source.url,
              expiresAt: source.expiresAt ?? null,
              offsetMs: source.offsetMs ?? 0,
              fps: source.fps ?? null,
            }
          : null,
      ];
    });
  return JSON.stringify(entries);
}

function extraSourcesFrom(key: string): Record<string, PreviewSource | null> {
  return Object.fromEntries(JSON.parse(key) as ExtraEntry[]);
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
    const {
      document: _document,
      source: _source,
      extraSources: _extraSources,
      ...fixed
    } = creation.current;
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

  const extraKey = extraSourcesKey(options.extraSources);
  useEffect(() => {
    if (!engine) return;
    engine.setExtraSources(extraSourcesFrom(extraKey));
  }, [engine, extraKey]);

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
