/**
 * Which value applies to a workspace, from the layers that may hold one.
 *
 * ## The order
 *
 * 1. The workspace's override, while it has not ended.
 * 2. The plan's stored value for the workspace's tier.
 * 3. The registry default (the Free value).
 *
 * The override wins even when it is lower than the plan, on purpose: vendors
 * often say "most generous wins", but then an operator could never lower one
 * workspace's allowance (for abuse). A lowered override carries its reason in
 * the Change Log.
 *
 * ## A stored value that no longer validates
 *
 * A key tightened in code can leave a stored value outside its new range. That
 * value is skipped, the next layer answers, and the skip is reported in
 * `rejected` so the API can log it once. A bad row therefore never grants
 * more than the code allows and never locks a workspace out.
 *
 * Pure and synchronous: the API's `EntitlementResolver` fetches the rows (and
 * caches them), then asks this function. The web app may call it too.
 */
import { type EntitlementDef, type Key, REGISTRY, type ValueOf } from './registry';
import { toValidDate, type ValidationCode, validateValue } from './validate';

/** Where a resolved value came from. */
export type ResolveSource = 'override' | 'plan' | 'default';

/** A workspace override as read from its row. */
export interface StoredOverride {
  readonly value: unknown;
  /** Ignored at or after this moment. */
  readonly expiresAt: Date | string;
}

/** The layers the caller read. */
export interface ResolveInput {
  /** The workspace's override row for this key, if any. */
  readonly override?: StoredOverride | null;
  /**
   * The tier's stored value. `undefined` means there is no row; `null` is a
   * stored value (unlimited, where the key allows it).
   */
  readonly planValue?: unknown;
  /** The server's clock. An override ends when `now` reaches `expiresAt`. */
  readonly now: Date;
}

/** A stored value that was skipped because it no longer passes validation. */
export interface RejectedLayer {
  readonly source: 'override' | 'plan';
  readonly code: ValidationCode;
}

/** The value that applies, where it came from, and any stored value that was skipped. */
export interface Resolved<K extends Key> {
  readonly key: K;
  readonly value: ValueOf<K>;
  readonly source: ResolveSource;
  readonly rejected: readonly RejectedLayer[];
}

/** Whether an override is still running at `now`. A date that cannot be read counts as ended. */
export function overrideActive(override: StoredOverride, now: Date): boolean {
  const end = toValidDate(override.expiresAt);
  const at = now.getTime();
  return end !== null && !Number.isNaN(at) && at < end.getTime();
}

/**
 * The value of `key` for one workspace: an unexpired override, then the plan
 * value, then the default. An override on a `plan` only key and a plan value
 * on an `org` only key are ignored, as if the row were not there.
 */
export function resolve<K extends Key>(key: K, input: ResolveInput): Resolved<K> {
  // Widened on purpose: today every key is scope `both`, but the rule holds for keys to come.
  const def: EntitlementDef = REGISTRY[key];
  const rejected: RejectedLayer[] = [];

  const override = input.override;
  if (override && def.scope !== 'plan' && overrideActive(override, input.now)) {
    const checked = validateValue(def, override.value);
    if (checked.ok) {
      return { key, value: checked.value as ValueOf<K>, source: 'override', rejected };
    }
    rejected.push({ source: 'override', code: checked.issues[0].code });
  }

  if (input.planValue !== undefined && def.scope !== 'org') {
    const checked = validateValue(def, input.planValue);
    if (checked.ok) {
      return { key, value: checked.value as ValueOf<K>, source: 'plan', rejected };
    }
    rejected.push({ source: 'plan', code: checked.issues[0].code });
  }

  return { key, value: def.default as ValueOf<K>, source: 'default', rejected };
}

/** Only the value of `resolve`, for callers that need nothing else. */
export function resolveValue<K extends Key>(key: K, input: ResolveInput): ValueOf<K> {
  return resolve(key, input).value;
}
