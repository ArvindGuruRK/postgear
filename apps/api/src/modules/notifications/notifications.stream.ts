/**
 * The open `GET /notifications/stream` connections, by workspace.
 *
 * A stream is one browser tab's bell. It is registered when the handler has
 * sent `ready`, removed when the client disconnects (the SSE helper's
 * `signal`) or when the module shuts down, and written to by two producers:
 * `NotificationsService.notify()` the moment it writes a row, and the
 * dispatcher's poll, which also sees that row a few seconds later. The two
 * would show every API-side event twice, so each stream remembers the ids it
 * has pushed and drops a repeat.
 *
 * `unread` is counted per stream, not re-queried: a pushed row is by
 * definition newer than the viewer's cursor, so each push is one more unread
 * until the tab marks all read — which the bell does through its own state,
 * and a reconnect re-reads the real count anyway.
 */
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { SseStream } from '../../common/sse';

/** The part of an SSE stream the registry uses — what a test fakes. */
export type StreamSink = Pick<SseStream, 'send' | 'close' | 'signal' | 'closed'>;

export interface PushedNotification {
  id: string;
  type: string;
  title: string | null;
  content: string;
  link: string | null;
  createdAt: Date;
}

/** How many pushed ids a stream remembers for de-duplication. */
const REMEMBERED_IDS = 200;

interface StreamHandle {
  sink: StreamSink;
  unread: number;
  pushed: Set<string>;
  pushedOrder: string[];
  release: () => void;
}

@Injectable()
export class NotificationStreamRegistry implements OnModuleDestroy {
  private readonly byOrg = new Map<string, Set<StreamHandle>>();

  /**
   * Registers a stream and sends its `ready` event. The returned promise
   * settles when the stream is gone, so a handler can await the connection's
   * lifetime and nothing else.
   */
  register(orgId: string, sink: StreamSink, unread: number): Promise<void> {
    return new Promise((resolve) => {
      const handle: StreamHandle = {
        sink,
        unread,
        pushed: new Set(),
        pushedOrder: [],
        release: () => {
          this.remove(orgId, handle);
          resolve();
        },
      };

      if (sink.signal.aborted || sink.closed) {
        resolve();
        return;
      }

      let streams = this.byOrg.get(orgId);
      if (!streams) {
        streams = new Set();
        this.byOrg.set(orgId, streams);
      }
      streams.add(handle);

      sink.signal.addEventListener('abort', handle.release, { once: true });
      sink.send('ready', { unread });
    });
  }

  /** Writes one row to every open stream of its workspace. Returns how many received it. */
  push(orgId: string, notification: PushedNotification): number {
    const streams = this.byOrg.get(orgId);
    if (!streams) {
      return 0;
    }

    let delivered = 0;

    for (const handle of streams) {
      if (handle.sink.closed) {
        handle.release();
        continue;
      }
      if (handle.pushed.has(notification.id)) {
        continue;
      }

      remember(handle, notification.id);
      handle.unread += 1;
      handle.sink.send('notification', {
        notification: {
          id: notification.id,
          type: notification.type,
          title: notification.title,
          content: notification.content,
          link: notification.link,
          createdAt: notification.createdAt.toISOString(),
          read: false,
        },
        unread: handle.unread,
      });
      delivered += 1;
    }

    return delivered;
  }

  /** Open streams for one workspace, or for all of them. */
  size(orgId?: string): number {
    if (orgId) {
      return this.byOrg.get(orgId)?.size ?? 0;
    }
    let total = 0;
    for (const streams of this.byOrg.values()) {
      total += streams.size;
    }
    return total;
  }

  /** Workspaces with at least one open stream — what the live push has to query for. */
  openWorkspaces(): string[] {
    return [...this.byOrg.keys()];
  }

  /** Ends every stream: the process is going down and a half-open response helps nobody. */
  closeAll(): void {
    for (const streams of this.byOrg.values()) {
      for (const handle of [...streams]) {
        handle.sink.close();
        handle.release();
      }
    }
    this.byOrg.clear();
  }

  onModuleDestroy(): void {
    this.closeAll();
  }

  private remove(orgId: string, handle: StreamHandle): void {
    const streams = this.byOrg.get(orgId);
    if (!streams) {
      return;
    }
    streams.delete(handle);
    if (streams.size === 0) {
      this.byOrg.delete(orgId);
    }
  }
}

function remember(handle: StreamHandle, id: string): void {
  handle.pushed.add(id);
  handle.pushedOrder.push(id);
  if (handle.pushedOrder.length > REMEMBERED_IDS) {
    const oldest = handle.pushedOrder.shift();
    if (oldest !== undefined) {
      handle.pushed.delete(oldest);
    }
  }
}
