'use client';

/**
 * The clip editor's autosave as a hook: one `ClipAutosave` for the editor's
 * life, told what is on screen after every change, with the browser's own
 * signals wired in (as Studio's `useAutosave`):
 *
 * - `online` sends a save that was waiting for the connection;
 * - `pagehide` sends what is unsaved on a request that outlives the tab;
 * - `beforeunload` asks before a tab with unsaved changes closes, and only
 *   then: never when everything is saved, or once Leave Anyway was pressed
 *   (`letGo`), so a move the router makes as a full page load does not ask
 *   a second time.
 *
 * A save answered 404 points the API back at the clip's own workspace before
 * it calls the clip gone (`saveInWorkspace`, shared with Studio): the API
 * answers 404 alike for a deleted clip and one in another workspace, and a
 * switch made in another tab would otherwise read here as a deletion.
 *
 * The controller is made in an effect, so React's double mount in
 * development closes the first one (which has nothing to send) and keeps
 * the second.
 */
import type { ClipDocument } from '@postgear/video-engine';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { saveInWorkspace } from '@/components/studio/editor-autosave';
import { api } from '@/lib/api';
import { updateClip } from '@/lib/clips-api';
import type { ClipView } from '@/types/clips';
import {
  ClipAutosave,
  type ClipSavedVersion,
  type ClipSaveRefusal,
  type ClipSaveState,
  type ClipScreenVersion,
  keepaliveFits,
} from './clip-autosave';

export interface ClipAutosaveHandle {
  status: ClipSaveState;
  /** Why the last save was refused and what is left, when the status is `failed`. */
  refusal: ClipSaveRefusal | null;
  /** Saves now; true once the server has everything on screen. */
  flush: () => Promise<boolean>;
  retry: () => void;
  /** A new starting point after a conflict (Reload). */
  replace: (saved: ClipSavedVersion, screen: ClipScreenVersion) => void;
  /** Leave Anyway was pressed: closing the page does not ask again, until the next edit. */
  letGo: () => void;
  /** Whether anything on screen is not on the server yet (read at the moment of asking). */
  isUnsaved: () => boolean;
}

export function useClipAutosave({
  orgId,
  clipId,
  initial,
  document,
  title,
  onSaved,
}: {
  orgId: string;
  clipId: string;
  /** What the server had when the editor opened. */
  initial: ClipSavedVersion;
  document: ClipDocument;
  title: string;
  onSaved?: (clip: ClipView) => void;
}): ClipAutosaveHandle {
  const [status, setStatus] = useState<ClipSaveState>('saved');
  const [refusal, setRefusal] = useState<ClipSaveRefusal | null>(null);
  const controller = useRef<ClipAutosave | null>(null);
  const saved = useRef(onSaved);
  const start = useRef(initial);
  const letGoAsked = useRef(false);

  useLayoutEffect(() => {
    saved.current = onSaved;
  });

  useEffect(() => {
    const autosave = new ClipAutosave(start.current, {
      send: (body, { keepalive }) =>
        saveInWorkspace(
          () => {
            const { revision, ...change } = body;
            return updateClip(clipId, revision, change, {
              // Over the cap the browser would refuse it outright: an ordinary
              // request still completes after a move within the app.
              keepalive: keepalive && keepaliveFits(body),
            });
          },
          () => api(`/orgs/${encodeURIComponent(orgId)}/switch`, { method: 'POST' }),
          keepalive,
        ),
      onStatus: (next, reason) => {
        setStatus(next);
        setRefusal(reason);
      },
      onSaved: (clip) => saved.current?.(clip),
      isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
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
  }, [orgId, clipId]);

  useEffect(() => {
    // Still here and still editing: closing the page asks again.
    letGoAsked.current = false;
    controller.current?.update({ document, title });
  }, [document, title]);

  const flush = useCallback(() => controller.current?.flush() ?? Promise.resolve(false), []);
  const retry = useCallback(() => controller.current?.retry(), []);
  const replace = useCallback(
    (next: ClipSavedVersion, screen: ClipScreenVersion) =>
      controller.current?.replace(next, screen),
    [],
  );
  const letGo = useCallback(() => {
    letGoAsked.current = true;
  }, []);
  const isUnsaved = useCallback(() => controller.current?.unsaved ?? false, []);

  return { status, refusal, flush, retry, replace, letGo, isUnsaved };
}
