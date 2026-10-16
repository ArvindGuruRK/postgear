'use client';

/**
 * The bell's data: the latest page of the feed, kept live over the
 * notification stream (Sprint 8).
 *
 * On mount the hook loads one page and opens `GET /notifications/stream`.
 * The stream's `ready` frame carries the unread count and every
 * `notification` frame a new row; both go through the reducer. When the
 * stream drops — a deploy, a proxy timeout, a laptop lid — it reconnects
 * with a doubling delay from one second to thirty, and because rows written
 * while it was down were never pushed, every *re*connect re-fetches the page
 * so nothing missed stays missed. Unmounting aborts the stream and stops the
 * timer; nothing here outlives the bell.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { api, ApiError } from '@/lib/api';
import type {
  NotificationsPage,
  NotificationStreamEvent,
  NotificationStreamReady,
} from '@/types/notifications';
import { isAbortError, openEventStream } from './event-stream';
import {
  initialNotificationsState,
  type NotificationsState,
  notificationsReducer,
  reconnectDelay,
} from './notifications-state';

/** The page the bell shows; older rows are on the server. */
export const PAGE_SIZE = 20;

export interface NotificationsHandle {
  state: NotificationsState;
  /** Re-fetches the page. Never throws; a failure lands in `state.error`. */
  refresh: () => Promise<void>;
  /** `POST /notifications/read-all`. Throws an `ApiError` so the caller can say so. */
  markAllRead: () => Promise<void>;
}

export function useNotifications(): NotificationsHandle {
  const [state, dispatch] = useReducer(notificationsReducer, undefined, initialNotificationsState);

  const refresh = useCallback(async () => {
    try {
      const page = await api<NotificationsPage>(`/notifications?limit=${PAGE_SIZE}`);
      dispatch({ type: 'loaded', page });
    } catch (error) {
      dispatch({
        type: 'load_failed',
        message:
          error instanceof ApiError ? error.message : "Couldn't load notifications right now.",
      });
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const result = await api<{ unread: 0; lastReadAt: string }>('/notifications/read-all', {
      method: 'POST',
    });
    dispatch({ type: 'read_all', lastReadAt: result.lastReadAt });
  }, []);

  // The latest `refresh` for the stream loop, which is started once.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let everOpened = false;
    let stopped = false;

    const connect = async () => {
      if (stopped) {
        return;
      }
      dispatch({ type: 'connection', state: 'connecting' });

      try {
        await openEventStream('/notifications/stream', {
          signal: controller.signal,
          onOpen: () => {
            dispatch({ type: 'connection', state: 'open' });
            if (everOpened) {
              // A reconnect: rows written while the stream was down were
              // never pushed, and the page is the only way to see them.
              void refreshRef.current();
            }
            everOpened = true;
            attempt = 0;
          },
          onEvent: ({ type, data }) => {
            if (type === 'ready' && isReady(data)) {
              dispatch({ type: 'ready', unread: data.unread });
            } else if (type === 'notification' && isStreamEvent(data)) {
              dispatch({ type: 'event', event: data });
            }
          },
        });
      } catch (error) {
        if (stopped || isAbortError(error)) {
          return;
        }
        // 401/403: the session is gone or the workspace changed. The layout
        // will redirect on its next render; backing off here keeps a dead
        // tab from hammering the API in the meantime.
      }

      if (stopped) {
        return;
      }

      dispatch({ type: 'connection', state: 'closed' });
      timer = setTimeout(() => {
        timer = null;
        void connect();
      }, reconnectDelay(attempt));
      attempt += 1;
    };

    void connect();

    return () => {
      stopped = true;
      controller.abort();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, []);

  return { state, refresh, markAllRead };
}

function isReady(data: unknown): data is NotificationStreamReady {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as NotificationStreamReady).unread === 'number'
  );
}

function isStreamEvent(data: unknown): data is NotificationStreamEvent {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const event = data as NotificationStreamEvent;
  return (
    typeof event.unread === 'number' &&
    typeof event.notification === 'object' &&
    event.notification !== null &&
    typeof event.notification.id === 'string' &&
    typeof event.notification.content === 'string'
  );
}
