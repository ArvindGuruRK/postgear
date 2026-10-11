/**
 * What every activity is built with.
 *
 * Activities are plain functions closed over these, created once at boot by
 * `createActivities` and handed to the worker — rather than importing
 * singletons — so a test can hand them a fake client or a simulated publisher
 * and the production wiring stays in one place (src/index.ts).
 */
import type { Client } from '@temporalio/client';
import type { WorkerEnv } from '../config/env';
import type { Publisher } from '../lib/publisher';
import type { Semaphore } from '../lib/semaphore';

export interface ActivityDeps {
  env: WorkerEnv;
  publisher: Publisher;
  /** Rations the platform calls themselves — see lib/semaphore.ts. */
  publishGate: Semaphore;
  /** Lazily provided so the publish activities need no Temporal client at all. */
  temporalClient: () => Promise<Client>;
  publicUrl: (key: string) => string;
}
