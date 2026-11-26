'use client';

/**
 * What the timeline canvases draw from (Module 07, section 2): the filmstrip
 * sheets as images and the waveform peaks as bytes, each loaded once per
 * signed address and kept in a small cache, so scrolling and zooming never
 * ask twice. A sheet that fails stays a gap (the canvas draws nothing there);
 * peaks that fail draw a flat line. Neither ever throws into React.
 *
 * Signed addresses change when they are refreshed, so the cache is keyed by
 * the address and capped; old entries fall out by age.
 */
import { useEffect, useState } from 'react';

const MAX_SHEETS = 64;
const MAX_PEAKS = 8;

type SheetEntry = {
  image: HTMLImageElement;
  ready: boolean;
  failed: boolean;
  waiters: Set<() => void>;
};
const sheets = new Map<string, SheetEntry>();

function remember<V>(cache: Map<string, V>, key: string, value: V, max: number) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > max) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * The sheet's image when it has loaded, else null; `onReady` runs once it
 * has (so the caller can draw again). Loading starts on the first ask.
 */
export function sheetImage(url: string, onReady: () => void): HTMLImageElement | null {
  let entry = sheets.get(url);
  if (!entry) {
    if (typeof Image === 'undefined') return null;
    const image = new Image();
    // No `crossOrigin`: the canvas only shows the pictures and never reads
    // them back, so a store without CORS still draws (the canvas is merely
    // marked unreadable).
    image.decoding = 'async';
    const created: SheetEntry = { image, ready: false, failed: false, waiters: new Set() };
    image.onload = () => {
      created.ready = true;
      for (const waiter of created.waiters) waiter();
      created.waiters.clear();
    };
    image.onerror = () => {
      created.failed = true;
      created.waiters.clear();
    };
    image.src = url;
    entry = created;
    remember(sheets, url, entry, MAX_SHEETS);
  }
  if (entry.ready) return entry.image;
  if (!entry.failed) entry.waiters.add(onReady);
  return null;
}

/** Forgets a waiter (a canvas that unmounted before its sheet arrived). */
export function forgetSheetWaiter(url: string, onReady: () => void) {
  sheets.get(url)?.waiters.delete(onReady);
}

const peaksCache = new Map<string, Promise<Uint8Array | null>>();

/**
 * The peaks in a waveform file. The import stores them as a JSON array of
 * numbers (`peaksToJson` in the worker); a file of raw bytes is read as is.
 * Reading the JSON's characters as peaks drew an even band and made every
 * second look equally loud.
 */
export function peaksFromFile(buffer: ArrayBuffer): Uint8Array {
  const bytes = new Uint8Array(buffer);
  let first = 0;
  while (first < bytes.length && /\s/.test(String.fromCharCode(bytes[first] ?? 0))) first += 1;
  if (bytes[first] !== 0x5b) return bytes;
  try {
    // The JSON is digits, commas and brackets only: plain ASCII, read in chunks.
    let text = '';
    for (let at = 0; at < bytes.length; at += 8_192) {
      text += String.fromCharCode(...bytes.subarray(at, at + 8_192));
    }
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return bytes;
    return Uint8Array.from(parsed, (value) =>
      typeof value === 'number' && Number.isFinite(value) ? value : 0,
    );
  } catch {
    // Raw bytes that happen to start with "[" (a peak of 91).
    return bytes;
  }
}

function loadPeaks(url: string): Promise<Uint8Array | null> {
  const known = peaksCache.get(url);
  if (known) return known;
  const loading = fetch(url, { credentials: 'omit' })
    .then((response) => (response.ok ? response.arrayBuffer() : null))
    .then((buffer) => (buffer ? peaksFromFile(buffer) : null))
    .catch(() => null);
  remember(peaksCache, url, loading, MAX_PEAKS);
  // A failure is not kept: the next address (a refreshed one) may work.
  void loading.then((peaks) => {
    if (peaks === null) peaksCache.delete(url);
  });
  return loading;
}

/** The waveform's bytes (one per `1 / perSecond` of a second, 0 to 255), or null until they arrive. */
export function usePeaks(url: string | null): Uint8Array | null {
  const [peaks, setPeaks] = useState<{ url: string; data: Uint8Array | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    void loadPeaks(url).then((data) => {
      if (live) setPeaks({ url, data });
    });
    return () => {
      live = false;
    };
  }, [url]);
  // Keep showing the last peaks while a refreshed address loads the same file.
  return peaks?.data ?? null;
}

/** Sizes a canvas for the screen's pixel density and returns its 2D context, scaled to CSS pixels. */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  widthPx: number,
  heightPx: number,
): CanvasRenderingContext2D | null {
  const ratio = typeof window === 'undefined' ? 1 : Math.min(3, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(widthPx * ratio));
  const height = Math.max(1, Math.round(heightPx * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, widthPx, heightPx);
  return context;
}
