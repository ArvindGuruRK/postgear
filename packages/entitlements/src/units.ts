/**
 * Meter units: what the ledger stores and what a person is shown.
 *
 * ## Thousandths
 *
 * The usage ledger stores whole thousandths (`UsageEntry.units` is an `Int`),
 * so sums are exact in Postgres and in JavaScript and a 61 minute 30 second
 * video costs exactly 61,500. `MILLI` is used only by the usage service and
 * these helpers.
 *
 * ## Rounding never favours the workspace
 *
 * A charge rounds up (`toMilli`), so a fraction is never free. On screen,
 * `used` rounds up while `remaining` and `limit` round down, so the page never
 * promises more than the server will allow.
 */

/** Ledger units per display unit (one minute is 1,000 units). */
export const MILLI = 1000;

/**
 * Display units to ledger units, rounding up so a fraction is never free.
 * Floating point noise is ignored first (0.1 minute is 100 units, not 101).
 * A number that is not finite throws: a charge must never be guessed.
 */
export function toMilli(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError('A usage amount must be a finite number.');
  }
  const scaled = amount * MILLI;
  const nearest = Math.round(scaled);
  // Products like 0.1 * 1000 land a hair above the whole number they mean.
  if (Math.abs(scaled - nearest) <= 1e-9 * Math.max(1, Math.abs(scaled))) {
    return nearest;
  }
  return Math.ceil(scaled);
}

/** Used units for display: whole display units, rounded up. Never negative. */
export function displayUsed(milli: number): number {
  if (!Number.isFinite(milli) || milli <= 0) return 0;
  return Math.ceil(milli / MILLI);
}

/** A remaining amount for display: whole display units, rounded down. Never negative. */
export function displayRemaining(milli: number): number {
  if (!Number.isFinite(milli) || milli <= 0) return 0;
  return Math.floor(milli / MILLI);
}

/** A limit for display: whole display units, rounded down; `null` (unlimited) stays `null`. */
export function displayLimit(limit: number | null): number | null {
  if (limit === null) return null;
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.floor(limit);
}

/** A meter as the browser and a refusal see it: whole display units only. */
export interface MeterAmounts {
  readonly used: number;
  /** `null` is unlimited. */
  readonly limit: number | null;
  /** `null` is unlimited. */
  readonly remaining: number | null;
}

/**
 * A meter's display amounts from the ledger sum and the limit. A limit lowered
 * below what is used leaves `remaining` at 0; nothing is clawed back.
 */
export function meterAmounts(usedMilli: number, limit: number | null): MeterAmounts {
  const used = displayUsed(usedMilli);
  if (limit === null) {
    return { used, limit: null, remaining: null };
  }
  const limitMilli = Number.isFinite(limit) ? toMilli(Math.max(0, limit)) : 0;
  return {
    used,
    limit: displayLimit(limit),
    remaining: displayRemaining(limitMilli - Math.max(0, usedMilli)),
  };
}

/**
 * Whether a charge of `unitsMilli` fits: `used + units` must not pass the
 * limit. Unlimited always fits. The usage service asks this inside its
 * transaction, against the limit it read there.
 */
export function fitsLimit(usedMilli: number, unitsMilli: number, limit: number | null): boolean {
  if (limit === null) return true;
  if (!Number.isFinite(usedMilli) || !Number.isFinite(unitsMilli) || !Number.isFinite(limit)) {
    return false;
  }
  return usedMilli + unitsMilli <= toMilli(limit);
}
