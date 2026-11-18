/**
 * The entitlement registry: every limit PostGear sells, declared once in code.
 *
 * ## What a key is
 *
 * A key (`clips.storage_gb`) names one limit. Its declaration here says what
 * kind of value it holds, the range an operator may store, the unit it is
 * shown in and which refusal it raises. The value for each plan tier is a
 * database row (`PlanEntitlement`), a workspace deal is an override row, and
 * this file only answers "what may be stored, and what applies when nothing
 * is". So an operator changes an allowance without a deploy, but can never
 * store a value the code does not understand.
 *
 * ## The default is the Free value
 *
 * When no row exists (a key shipped before its seed, a row deleted by hand),
 * the registry default answers. It is always the safest value, the Free one,
 * so a missing row can never grant more than the Free plan.
 *
 * ## Four types
 *
 * - `boolean`: a gate (`clips.enabled`) or a switch copied into a job.
 * - `number`: a ceiling or a gauge (`clips.storage_gb`); the module that owns
 *   the rows measures the gauge, the registry only supplies the limit.
 * - `enum`: an ordered ladder, low to high (`clips.export_max_quality`), so
 *   "at or below the allowed one" is an index comparison. `reserved` members
 *   are listed in the ladder but can never be stored (4K, until it is built).
 * - `meter`: an allowance that is used up and comes back (`clips.ai_minutes_per_month`),
 *   counted on the usage ledger over a window (`cycle` or `day`).
 *
 * Pure: no Node built-ins and no other `@postgear/*` package, because the web
 * app imports it to lock tiles and draw meters.
 */
import { CLIPS_ENTITLEMENTS } from './keys/clips';

/** What a limit is measured in, for display and for the operator's editor. */
export type EntitlementUnit = 'minutes' | 'gigabytes' | 'days' | 'count' | 'credits' | 'none';

/**
 * Where a stored value may exist: `plan` only on a plan row (never overridden),
 * `org` only as a workspace override, `both` on either.
 */
export type EntitlementScope = 'plan' | 'org' | 'both';

/** The module a key belongs to; the operator's Plans table groups rows by it. */
export type EntitlementGroup = 'clips';

/** Singular and plural nouns for a count ("1 download", "5 downloads"). */
export interface CountNoun {
  readonly one: string;
  readonly other: string;
}

/** What every key declares, whatever its type. */
interface EntitlementCommon {
  /** The lookup key, equal to its name in the registry map. */
  readonly key: string;
  readonly group: EntitlementGroup;
  /** Title Case name for the operator's table ("Clips Storage"). */
  readonly label: string;
  /** One plain sentence on what the key limits. */
  readonly description: string;
  readonly scope: EntitlementScope;
  /** Who may edit stored values. Only operators today; a workspace admin setting would add a second. */
  readonly editors: 'operator';
  /**
   * The snake_case code a refusal on this key carries (at most 64 characters,
   * so the API's exception filter passes it). Absent for keys that never refuse.
   */
  readonly refusalCode?: string;
}

/** A yes or no gate. */
export interface BooleanEntitlementDef extends EntitlementCommon {
  readonly type: 'boolean';
  readonly unit: 'none';
  readonly default: boolean;
}

/** A ceiling or a gauge. `null` means unlimited, and only where `allowUnlimited` says so. */
export interface NumberEntitlementDef extends EntitlementCommon {
  readonly type: 'number';
  readonly unit: EntitlementUnit;
  readonly default: number | null;
  readonly min: number;
  readonly max: number;
  /** Whether a fraction may be stored (1.5 GB). Whole numbers otherwise. */
  readonly integer: boolean;
  readonly allowUnlimited?: boolean;
  /** For `count`: what is counted. */
  readonly noun?: CountNoun;
}

/** An ordered ladder, low to high. */
export interface EnumEntitlementDef extends EntitlementCommon {
  readonly type: 'enum';
  readonly unit: 'none';
  /** Ordered low to high; reserved members included, so their place on the ladder is fixed. */
  readonly options: readonly string[];
  /** Members listed in the ladder that can never be stored yet. */
  readonly reserved?: readonly string[];
  /** How each member reads on a card or in a sentence ("1080p 60 fps"). */
  readonly optionLabels: Readonly<Record<string, string>>;
  readonly default: string;
}

/** An allowance used up over a window and counted on the usage ledger. */
export interface MeterEntitlementDef extends EntitlementCommon {
  readonly type: 'meter';
  readonly unit: EntitlementUnit;
  /** `cycle`: the billing cycle (`cycleFor`). `day`: midnight UTC to midnight UTC (`dayWindow`). */
  readonly window: 'cycle' | 'day';
  /** `hard` refuses past the limit; `soft` records and flags `over`. */
  readonly limit: 'hard' | 'soft';
  readonly default: number;
  readonly min: number;
  readonly max: number;
  /** Whether a fraction may be stored as the limit. */
  readonly integer: boolean;
  readonly allowUnlimited?: boolean;
  readonly noun?: CountNoun;
}

/** One registry entry. */
export type EntitlementDef =
  | BooleanEntitlementDef
  | NumberEntitlementDef
  | EnumEntitlementDef
  | MeterEntitlementDef;

/** A value as stored in JSON: a boolean, a number, an enum member, or `null` for unlimited. */
export type EntitlementValue = boolean | number | string | null;

/**
 * Every key PostGear knows. New modules add their own map here, the way
 * Clips does, and ship a migration with their seed rows.
 */
export const REGISTRY = {
  ...CLIPS_ENTITLEMENTS,
} as const;

/** A registry key. */
export type Key = keyof typeof REGISTRY;

/** The declaration type of one key, with its literal options and flags kept. */
export type DefOf<K extends Key> = (typeof REGISTRY)[K];

/** The value a key resolves to. Enum keys give their storable members only; unlimited keys may give `null`. */
export type ValueOfDef<D> = D extends { readonly type: 'boolean' }
  ? boolean
  : D extends { readonly type: 'enum'; readonly options: readonly (infer O)[] }
    ? Exclude<O, D extends { readonly reserved: readonly (infer R)[] } ? R : never>
    : D extends { readonly allowUnlimited: true }
      ? number | null
      : number;

/** The value of a registry key. */
export type ValueOf<K extends Key> = ValueOfDef<DefOf<K>>;

/** Keys whose type is `meter`. */
export type MeterKey = {
  [K in Key]: DefOf<K> extends { readonly type: 'meter' } ? K : never;
}[Key];

/** Every key, in declaration order (the order the operator's table and the plan card use). */
export const KEYS: readonly Key[] = Object.freeze(Object.keys(REGISTRY) as Key[]);

/** Every meter key. */
export const METER_KEYS: readonly MeterKey[] = Object.freeze(
  KEYS.filter((key): key is MeterKey => REGISTRY[key].type === 'meter'),
);

/** Whether a string from a database row or a request body names a known key. */
export function isKey(value: unknown): value is Key {
  return typeof value === 'string' && Object.hasOwn(REGISTRY, value);
}

/** Whether a key is a meter, so it can be charged. */
export function isMeterKey(value: unknown): value is MeterKey {
  return isKey(value) && REGISTRY[value].type === 'meter';
}

/** The declaration of a key, or `undefined` for a name the code does not know. */
export function getDef(key: string): EntitlementDef | undefined {
  return isKey(key) ? (REGISTRY[key] as EntitlementDef) : undefined;
}

/** The default (Free) value of a key: what applies when no row exists. */
export function defaultValue<K extends Key>(key: K): ValueOf<K> {
  return REGISTRY[key].default as ValueOf<K>;
}

/** The refusal code a key raises, or `undefined` for a key that never refuses. */
export function refusalCodeOf(key: Key): string | undefined {
  const def: EntitlementDef = REGISTRY[key];
  return def.refusalCode;
}

/**
 * The shape a refusal code must have: snake_case, starting with a letter, at
 * most 64 characters. The API's exception filter passes only codes like this.
 */
export const REFUSAL_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Where `value` sits on an enum key's ladder (0 is the lowest), or -1 when it
 * is not a member. Reserved members have a place too, so a comparison against
 * one still orders correctly.
 */
export function enumRank(def: EnumEntitlementDef, value: unknown): number {
  return typeof value === 'string' ? def.options.indexOf(value) : -1;
}

/**
 * Whether `wanted` is at or below `allowed` on an enum key's ladder. False for
 * anything that is not a member, so an unknown value is never allowed.
 */
export function enumAtOrBelow(def: EnumEntitlementDef, wanted: unknown, allowed: unknown): boolean {
  const ceiling = enumRank(def, allowed);
  const rank = enumRank(def, wanted);
  return ceiling >= 0 && rank >= 0 && rank <= ceiling;
}
