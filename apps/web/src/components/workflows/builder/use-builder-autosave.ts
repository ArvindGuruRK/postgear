'use client';

/**
 * The builder's autosave as a hook: one `BuilderAutosave` for the life of
 * the page, told what is on screen after every change, with the browser's
 * signals wired in (the Studio editor's `use-autosave.ts` is the model):
 *
 * - `online` sends a save that was waiting for the connection;
 * - `pagehide` sends what is unsaved on a request that outlives the tab,
 *   when it fits the browser's 64 KB cap for one;
 * - `beforeunload` asks before a tab with unsaved changes closes, and only
 *   then.
 *
 * Made in an effect, not during render, so React's double mount in
 * development closes the first controller (which has nothing to send).
 */
import type { AutomationGraph } from '@postgear/automation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { AutomationSaveResult } from '@/types/workflows';
import { BuilderAutosave, type SaveBody, type SaveStatus } from './builder-autosave';

const KEEPALIVE_MAX_BYTES = 60_000;

function fits(body: SaveBody): boolean {
  return new TextEncoder().encode(JSON.stringify(body)).length <= KEEPALIVE_MAX_BYTES;
}

export interface BuilderAutosaveHandle {
  status: SaveStatus;
  /** Why the last save was refused, when the status is `failed`. */
  message: string | null;
  /** Saves now; true once the server has everything on screen. */
  flush: () => Promise<boolean>;
  retry: () => void;
  /** Anything on screen the server has not confirmed. */
  unsaved: () => boolean;
  /** Leave Anyway was chosen: closing the page does not ask again. */
  letGo: () => void;
}

export function useBuilderAutosave({
  automationId,
  initial,
  graph,
  name,
  onSaved,
}: {
  automationId: string;
  initial: { graph: AutomationGraph; name: string; revision: number };
  graph: AutomationGraph;
  name: string;
  onSaved?: (result: AutomationSaveResult) => void;
}): BuilderAutosaveHandle {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [message, setMessage] = useState<string | null>(null);
  const controller = useRef<BuilderAutosave | null>(null);
  const start = useRef(initial);
  const saved = useRef(onSaved);
  const letGoAsked = useRef(false);

  useLayoutEffect(() => {
    saved.current = onSaved;
  });

  useEffect(() => {
    const autosave = new BuilderAutosave(start.current, {
      send: (body, { keepalive }) =>
        api<{ automation: AutomationSaveResult }>(
          `/automations/${encodeURIComponent(automationId)}`,
          {
            method: 'PATCH',
            body,
            keepalive: keepalive && fits(body),
          },
        ).then((result) => result.automation),
      onStatus: (next, why) => {
        setStatus(next);
        setMessage(why);
      },
      onSaved: (result) => saved.current?.(result),
      isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    });
    controller.current = autosave;

    const online = () => autosave.online();
    const hide = () => autosave.keepalive();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (letGoAsked.current || !autosave.unsaved) return;
      event.preventDefault();
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
  }, [automationId]);

  useEffect(() => {
    letGoAsked.current = false;
    controller.current?.update({ graph, name });
  }, [graph, name]);

  const flush = useCallback(() => controller.current?.flush() ?? Promise.resolve(false), []);
  const retry = useCallback(() => controller.current?.retry(), []);
  const unsaved = useCallback(() => controller.current?.unsaved ?? false, []);
  const letGo = useCallback(() => {
    letGoAsked.current = true;
  }, []);

  return { status, message, flush, retry, unsaved, letGo };
}
