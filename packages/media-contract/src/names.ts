/**
 * The names both languages share, with no runtime dependency at all, so a
 * Temporal workflow (the sandbox) can import them without pulling in Zod.
 *
 * - **Activity names** are plain strings matched by the Temporal server. The
 *   Python side registers `@activity.defn(name="mediaPyHealth")` with the
 *   same string; nothing derives it from a function name.
 * - **The contract version** goes in every input (`version`), so a newer Node
 *   side can be told from an older Python side, and back.
 * - **Error types** are the `type` of a Python `ApplicationError`. That
 *   string is what crosses the language line; the list says which ones a
 *   retry cannot fix.
 */

/** Bumped when a shape changes in a way an older peer cannot read. */
export const MEDIA_CONTRACT_VERSION = 1 as const;

/** Every Python activity, by its Temporal activity type. */
export const MEDIA_PY_ACTIVITY_NAMES = {
  health: 'mediaPyHealth',
  transcribe: 'mediaPyTranscribe',
  detectFaces: 'mediaPyDetectFaces',
  motion: 'mediaPyMotion',
  stills: 'mediaPyStills',
  speak: 'mediaPySpeak',
} as const;

export type MediaPyActivityName =
  (typeof MEDIA_PY_ACTIVITY_NAMES)[keyof typeof MEDIA_PY_ACTIVITY_NAMES];

/**
 * The error types a Python activity may raise. `retryable: false` ones end the
 * activity at once (the caller's retry policy lists them as non-retryable).
 */
export const MEDIA_ERROR_TYPES = {
  /** The input did not match the contract. A retry sends the same input. */
  MEDIA_BAD_INPUT: { retryable: false },
  /** The two sides speak different contract versions (a half-finished deploy). */
  MEDIA_CONTRACT_MISMATCH: { retryable: false },
  /** A storage key named in the input does not exist. */
  MEDIA_KEY_NOT_FOUND: { retryable: false },
  /** The sound could not be decoded. */
  MEDIA_BAD_AUDIO: { retryable: false },
  /** The picture could not be decoded. */
  MEDIA_BAD_VIDEO: { retryable: false },
  /** The language asked for is not one the binding can read. */
  MEDIA_LANGUAGE_UNSUPPORTED: { retryable: false },
  /** A binding is switched off on this service (for example the hosted lane with no key). */
  MEDIA_BINDING_OFF: { retryable: false },
  /** Something on the box failed (disk, memory, a hosted service): worth another try. */
  MEDIA_TOOL_FAILED: { retryable: true },
} as const;

export type MediaErrorType = keyof typeof MEDIA_ERROR_TYPES;

/** The error types a retry cannot fix, for the caller's retry policy. */
export const MEDIA_NON_RETRYABLE_ERRORS: readonly MediaErrorType[] = Object.freeze(
  (Object.keys(MEDIA_ERROR_TYPES) as MediaErrorType[]).filter(
    (type) => !MEDIA_ERROR_TYPES[type].retryable,
  ),
);
