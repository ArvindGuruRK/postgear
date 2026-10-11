/**
 * Connections to the Temporal server, for the worker and for its own client.
 *
 * Two connections because the SDK needs two: the worker polls through a native
 * (Rust core) connection, while activities that start other workflows — the
 * maintenance reconcile — use the ordinary gRPC client.
 *
 * Both retry at boot. The worker usually starts in the same `docker compose up`
 * as Temporal, which takes a good thirty seconds to run its schema setup, and
 * a worker that crashed because it won the race would need a human to restart
 * it. Retrying with a bounded backoff is what lets `npm run dev` just work.
 */
import { Client, Connection } from '@temporalio/client';
import { NativeConnection } from '@temporalio/worker';
import type { WorkerEnv } from '../config/env';

const MAX_WAIT_MS = 2 * 60_000;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 10_000;

type TemporalEnv = Pick<WorkerEnv, 'TEMPORAL_HOST' | 'TEMPORAL_NAMESPACE'>;

async function withRetry<T>(label: string, connect: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + MAX_WAIT_MS;
  let attempt = 0;

  for (;;) {
    try {
      return await connect();
    } catch (error) {
      attempt += 1;
      const delay = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);

      if (Date.now() + delay > deadline) {
        throw error;
      }

      console.warn(
        `[worker] ${label}: Temporal not reachable yet (${
          error instanceof Error ? error.message : String(error)
        }); retrying in ${Math.round(delay / 1_000)}s`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function connectWorker(env: TemporalEnv): Promise<NativeConnection> {
  return withRetry('worker connection', () =>
    NativeConnection.connect({ address: env.TEMPORAL_HOST }),
  );
}

export async function connectClient(env: TemporalEnv): Promise<Client> {
  const connection = await withRetry('client connection', () =>
    Connection.connect({ address: env.TEMPORAL_HOST, connectTimeout: '5s' }),
  );

  return new Client({ connection, namespace: env.TEMPORAL_NAMESPACE });
}
