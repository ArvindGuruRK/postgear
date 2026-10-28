'use client';

/**
 * The editor's autosave as a hook: one `Autosave` (see `editor-autosave.ts`)
 * for the life of the editor, told what is on screen after every change,
 * with the browser's own signals wired in:
 *
 * - `online` sends a save that was waiting for the connection;
 * - `pagehide` sends what is unsaved on a request that outlives the tab;
 * - `beforeunload` asks before a tab with unsaved changes closes (DS-6.3),
 *   and only then: no warning when everything is saved, or once the person
 *   has pressed Leave Anyway (`letGo`), so a move the router has to make as
 *   a full page load (offline, say) does not ask a second time.
 *
 * Each save asks for `keepalive` only while its body fits the browser's cap
 * for one (`keepaliveFits`), and a save answered 404 points the API back at
 * the design's own workspace before it calls the design gone
 * (`saveInWorkspace`). A save refused for a premium look the workspace's plan
 * does not include is held until the look is taken out (`addsPremiumLook`),
 * never sent again as it was.
 *
 * The controller is made in an effect, not during render, so React's double
 * mount in development closes the first one (which has nothing to send) and
 * keeps the second.
 */
import type { DesignDocument } from '@postgear/design-engine';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { DesignSaveResult } from '@/types/studio';
import {
  Autosave,
  keepaliveFits,
  type SavedVersion,
  type SaveRefusal,
  type ScreenVersion,
  saveInWorkspace,
} from './editor-autosave';
import { isPremiumRefusal } from './premium-lock';
import { addsPremiumLook } from './premium-model';
import type { SaveState } from './studio-view-model';

export interface AutosaveHandle {
  status: SaveState;
  /** Why the last save was refused and what is left to do, when the status is `failed`. */
  refusal: SaveRefusal | null;
  /** Saves now; true once the server has everything on screen. */
  flush: () => Promise<boolean>;
  /** Try Again after a refusal. */
  retry: () => void;
  /** A new starting point after a conflict (Reload, or keeping the version on screen). */
  replace: (saved: SavedVersion, screen: ScreenVersion) => void;
  /** Leave Anyway was pressed: closing the page does not ask again, until the next edit. */
  letGo: () => void;
}

export function useAutosave({
  orgId,
  designId,
  initial,
  document,
  title,
  slideIndex,
  onSaved,
}: {
  /** The design's workspace, which a save answered 404 points the API back at. */
  orgId: string;
  designId: string;
  /** What the server had when the editor opened. */
  initial: SavedVersion;
  document: DesignDocument;
  title: string;
  slideIndex: number;
  onSaved: (result: DesignSaveResult) => void;
}): AutosaveHandle {
  const [status, setStatus] = useState<SaveState>('saved');
  const [refusal, setRefusal] = useState<SaveRefusal | null>(null);
  const controller = useRef<Autosave | null>(null);
  const saved = useRef(onSaved);
  const start = useRef({ initial, slideIndex });
  const letGoAsked = useRef(false);

  useLayoutEffect(() => {
    saved.current = onSaved;
  });

  useEffect(() => {
    const autosave = new Autosave(start.current.initial, start.current.slideIndex, {
      send: (body, { keepalive }) =>
        saveInWorkspace(
          () =>
            api<{ design: DesignSaveResult }>(`/studio/designs/${encodeURIComponent(designId)}`, {
              method: 'PATCH',
              body,
              // Over the cap the browser would refuse it outright: an ordinary
              // request still completes after a move within the app.
              keepalive: keepalive && keepaliveFits(body),
            }).then((result) => result.design),
          () => api(`/orgs/${encodeURIComponent(orgId)}/switch`, { method: 'POST' }),
          keepalive,
        ),
      onStatus: (next, reason) => {
        setStatus(next);
        setRefusal(reason);
      },
      onSaved: (result) => saved.current(result),
      isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
      isPremiumRefusal,
      premiumHeld: addsPremiumLook,
    });
    controller.current = autosave;

    const online = () => autosave.online();
    const hide = () => autosave.keepalive();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (letGoAsked.current || !autosave.unsaved) return;
      event.preventDefault();
      // Older browsers show the prompt only when this is set.
      event.returnValue = '';
    };

    window.addEventListener('online', online);
    window.addEventListener('pagehide', hide);
    window.addEventListener('beforeunload', beforeUnload);

    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('beforeunload', beforeUnload);
      autosave.dispose();
      if (controller.current === autosave) controller.current = null;
    };
  }, [orgId, designId]);

  useEffect(() => {
    // Still here and still editing: closing the page asks again.
    letGoAsked.current = false;
    controller.current?.update({ document, title, slideIndex });
  }, [document, title, slideIndex]);

  const flush = useCallback(() => controller.current?.flush() ?? Promise.resolve(false), []);
  const retry = useCallback(() => controller.current?.retry(), []);
  const replace = useCallback(
    (next: SavedVersion, screen: ScreenVersion) => controller.current?.replace(next, screen),
    [],
  );
  const letGo = useCallback(() => {
    letGoAsked.current = true;
  }, []);

  return { status, refusal, flush, retry, replace, letGo };
}
