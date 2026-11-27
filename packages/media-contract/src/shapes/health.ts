/**
 * `mediaPyHealth`: what the Python service is, and what it can do right now.
 *
 * Called by `clipRuntimeCheckWorkflow` with a short limit; an answer means the
 * Python worker is polling `postgear-media-py`, so AI buttons can be live.
 */
import { z } from 'zod/v4';
import { contractVersion } from './common';

export const BINDING_STATES = ['simulation', 'live', 'off'] as const;

export const mediaPyHealthInput = z
  .strictObject({ version: contractVersion })
  .meta({ id: 'MediaPyHealthInput', title: 'MediaPyHealthInput' });

export const binding = z
  .strictObject({
    /** `simulation` answers from recorded files, `live` runs the real library, `off` cannot run. */
    state: z.enum(BINDING_STATES),
    /** What runs it, such as `faster-whisper` or `simulation`. Never a path or a key. */
    name: z.string().min(1).max(64),
  })
  .meta({ id: 'Binding' });

export const mediaPyHealthOutput = z
  .strictObject({
    /** The contract version the service speaks. */
    contractVersion: z.number().int().min(1),
    /** The service's own version (`pyproject.toml`). */
    serviceVersion: z.string().min(1).max(32),
    /** The Python it runs on, such as `3.13.18`. */
    pythonVersion: z.string().min(1).max(32),
    /** `MEDIA_SIMULATION` is on: every binding answers from recorded files. */
    simulation: z.boolean(),
    /** The queue it polls. */
    taskQueue: z.string().min(1).max(64),
    bindings: z.strictObject({
      transcriber: binding,
      faces: binding,
      motion: binding,
      stills: binding,
      /** Module 09: the voice Text To Speech uses (`simulation`, or `kokoro` run as its own program). */
      speaker: binding,
    }),
    /** Whether the model files a live binding needs are on this box. */
    modelsPresent: z.boolean(),
  })
  .meta({ id: 'MediaPyHealthOutput', title: 'MediaPyHealthOutput' });

export type MediaPyHealthInput = z.infer<typeof mediaPyHealthInput>;
export type MediaPyHealthOutput = z.infer<typeof mediaPyHealthOutput>;
