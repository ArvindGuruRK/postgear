'use client';

/**
 * The workspace's saved channels (Module 06, section 6): loaded once, then
 * kept in step with what this page adds and removes, so the Streams tab and
 * the Browse dialog never ask twice for what they already know. Nothing is
 * asked until `enabled` first turns true (the Streams tab or the dialog is
 * opened). A newer load always wins (an `AbortController` and a sequence
 * guard).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { listChannels } from '@/lib/clips-api';
import type { ClipChannelView } from '@/types/clips';

export const CHANNELS_LOAD_FAILED = 'We could not load your channels. Try again.';

export interface ChannelsState {
  channels: ClipChannelView[];
  loading: boolean;
  /** The sentence to show when the list did not load. */
  error: { message: string; code: string | undefined } | null;
  reload: () => void;
  /** A channel the Add dialog saved: first in the list, and never twice. */
  added: (channel: ClipChannelView) => void;
  removed: (channelId: string) => void;
}

export function useChannels(
  enabled = true,
  load: typeof listChannels = listChannels,
): ChannelsState {
  const [channels, setChannels] = useState<ClipChannelView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ChannelsState['error']>(null);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const reload = useCallback(() => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const mine = ++sequence.current;
    setLoading(true);
    setError(null);
    load({ signal: abort.signal })
      .then((next) => {
        if (mine !== sequence.current) return;
        setChannels(next);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (mine !== sequence.current || abort.signal.aborted) return;
        setLoading(false);
        setError(
          cause instanceof ApiError && cause.status !== 0
            ? { message: cause.message, code: cause.code }
            : { message: CHANNELS_LOAD_FAILED, code: undefined },
        );
      });
  }, [load]);

  const started = useRef(false);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    reload();
  }, [enabled, reload]);
  // Unmounting (also React's dev double mount) stops the load and lets the
  // next mount ask again.
  useEffect(
    () => () => {
      controller.current?.abort();
      started.current = false;
    },
    [],
  );

  const added = useCallback((channel: ClipChannelView) => {
    setChannels((current) => [channel, ...current.filter((one) => one.id !== channel.id)]);
  }, []);

  const removed = useCallback((channelId: string) => {
    setChannels((current) => current.filter((one) => one.id !== channelId));
  }, []);

  return { channels, loading, error, reload, added, removed };
}
