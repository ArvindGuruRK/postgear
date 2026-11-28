/**
 * The usage ledger (Sprint 12, research 12 section 7): charges, refunds and
 * operator adjustments for every meter, in thousandths.
 *
 * ## The charge
 *
 * `consume` is one Serializable transaction, the shape of
 * `CreditsRepository.chargeOnce`, in three statements: look for the
 * idempotency key (found means `duplicate: true`, nothing charged), sum the
 * window, then refuse with the typed 402 or insert. A concurrent duplicate
 * that slipped past the look-up hits the unique index (`P2002`) and gets the
 * existing row. A concurrent different charge makes Postgres abort one side
 * (`P2034`), retried three times with a 50 ms backoff. Any other database
 * error fails closed with a 503: a charge is never skipped.
 *
 * ## Keys
 *
 * Fixed for every module (research 12 section 7.2): import minutes
 * `clips.import:<jobId>`, AI steps `clips.ai:<step>:<jobId>`, downloads
 * `clips.download:<jobId>`, reversals `rev:<entryId>` (`:<n>` for a partial
 * one). Keys are scoped to the workspace by the unique index.
 *
 * ## Refunds
 *
 * A reversal is a negative row with the same `cycleStart` as its original,
 * so a refund of last month's charge changes nothing in this month. It can
 * never exceed what was charged, never reverses a reversal, and is
 * idempotent through its key.
 */
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type PrismaTransactionClient, prisma, type UsageEntry, UsageKind } from '@postgear/db';
import {
  type EntitlementDef,
  fitsLimit,
  type MeterKey,
  meterAmounts,
  REGISTRY,
  refusalCodeOf,
  refusalMessage,
  toMilli,
} from '@postgear/entitlements';
import { EntitlementRefusedException } from './entitlement-refused.exception';
import { EntitlementResolver, type MeterState } from './entitlement-resolver';
import { ENTITLEMENT_MESSAGES } from './entitlements.messages';
import { EntitlementsRepository } from './entitlements.repository';

const LEDGER_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  timeout: 5_000,
} as const;

const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 50;

export interface ConsumeOptions {
  idempotencyKey: string;
  /** The job (or other row) the charge is for: for finding it, never for security. */
  refId?: string;
  /** Small, no personal data. */
  meta?: Record<string, string | number | boolean | null>;
  now?: Date;
}

export interface ConsumeResult {
  entryId: string;
  duplicate: boolean;
  /** Only for a `soft` meter: the charge went past the limit. */
  over: boolean;
  state: MeterState;
}

type LedgerOutcome =
  | { kind: 'charged'; entry: UsageEntry; usedMilli: number; over: boolean }
  | { kind: 'duplicate'; entry: UsageEntry }
  | { kind: 'refused'; usedMilli: number };

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    private readonly repository: EntitlementsRepository,
    private readonly resolver: EntitlementResolver,
  ) {}

  /**
   * Charges `units` (display units: minutes, downloads) to a meter. Throws
   * the typed 402 when a hard limit would be passed; answers the existing
   * row with `duplicate: true` for a key already charged.
   */
  async consume(orgId: string, meter: MeterKey, units: number, options: ConsumeOptions): Promise<ConsumeResult> {
    if (!Number.isFinite(units) || units <= 0) {
      throw new RangeError('A charge must be a positive, finite amount.');
    }
    assertKey(options.idempotencyKey);

    const now = options.now ?? new Date();
    const def = meterDef(meter);
    const unitsMilli = toMilli(units);
    const meterNow = await this.resolver.exactMeter(orgId, meter, now);
    const limit = meterNow.limitValue;
    const cycleStart = meterNow.cycleStart;

    const outcome = await this.withRetries('consume', () =>
      prisma.$transaction(async (tx) => {
        const existing = await this.repository.findByKey(tx, orgId, options.idempotencyKey);
        if (existing) return { kind: 'duplicate', entry: existing } satisfies LedgerOutcome;

        const usedMilli = await this.repository.sumUnits(tx, orgId, meter, cycleStart);
        const fits = fitsLimit(usedMilli, unitsMilli, limit);
        if (!fits && def.limit === 'hard') {
          return { kind: 'refused', usedMilli } satisfies LedgerOutcome;
        }

        const entry = await this.repository.insert(tx, {
          organizationId: orgId,
          meter,
          units: unitsMilli,
          kind: UsageKind.CHARGE,
          idempotencyKey: options.idempotencyKey,
          refId: options.refId ?? null,
          reversesId: null,
          cycleStart,
          meta: options.meta,
          createdBy: null,
        });
        return { kind: 'charged', entry, usedMilli: usedMilli + unitsMilli, over: !fits } satisfies LedgerOutcome;
      }, LEDGER_OPTIONS),
      // A duplicate that won the race against our look-up: answer its row.
      async () => {
        const entry = await this.repository.findByKey(prisma, orgId, options.idempotencyKey);
        return entry ? ({ kind: 'duplicate', entry } satisfies LedgerOutcome) : null;
      },
    );

    if (outcome.kind === 'refused') {
      const amounts = meterAmounts(outcome.usedMilli, limit);
      const code = refusalCodeOf(meter) ?? 'clips_not_in_plan';
      this.logger.log(
        JSON.stringify({ event: 'entitlement.refused', orgId, key: meter, code, limit, used: amounts.used }),
      );
      throw new EntitlementRefusedException(
        code,
        refusalMessage(code, {
          // The AI sentence says what is left; the others name the plan's number.
          n: meter === 'clips.ai_minutes_per_month' ? (amounts.remaining ?? undefined) : (amounts.limit ?? undefined),
          need: units,
          date: meterNow.cycleEnd,
        }),
        { limit: amounts.limit, used: amounts.used, needed: Math.ceil(units), remaining: amounts.remaining },
      );
    }

    const usedMilli =
      outcome.kind === 'charged'
        ? outcome.usedMilli
        : await this.repository.sumUnits(prisma, orgId, meter, cycleStart);
    const amounts = meterAmounts(usedMilli, limit);
    return {
      entryId: outcome.entry.id,
      duplicate: outcome.kind === 'duplicate',
      over: outcome.kind === 'charged' && outcome.over,
      state: { ...amounts, cycleStart, cycleEnd: meterNow.cycleEnd },
    };
  }

  /**
   * Gives back a charge, in full or `units` of it (display units). Stored in
   * the original's window. Refuses more than is left to give back and the
   * reversal of a reversal; idempotent through `rev:<entryId>`, or
   * `rev:<entryId>:<n>` for the n-th partial refund.
   */
  async reverse(
    orgId: string,
    entryId: string,
    options: { units?: number; part?: number } = {},
  ): Promise<{ entryId: string; duplicate: boolean }> {
    if (options.units !== undefined && (!Number.isFinite(options.units) || options.units <= 0)) {
      throw new RangeError('A refund must be a positive, finite amount.');
    }
    const key = options.part === undefined ? `rev:${entryId}` : `rev:${entryId}:${options.part}`;

    const outcome = await this.withRetries(
      'reverse',
      () =>
        prisma.$transaction(async (tx) => {
          const existing = await this.repository.findByKey(tx, orgId, key);
          if (existing) return { kind: 'duplicate' as const, entry: existing };

          const original = await this.repository.findEntry(tx, orgId, entryId);
          if (!original) {
            throw new NotFoundException({ message: ENTITLEMENT_MESSAGES.ENTRY_NOT_FOUND, code: 'entry_not_found' });
          }
          if (original.kind !== UsageKind.CHARGE) {
            throw new BadRequestException({
              message: ENTITLEMENT_MESSAGES.REVERSAL_OF_REVERSAL,
              code: 'reversal_not_allowed',
            });
          }

          const alreadyBack = -(await this.repository.reversedUnits(tx, original.id));
          const left = original.units - alreadyBack;
          const wanted = options.units === undefined ? left : toMilli(options.units);
          if (wanted <= 0 || wanted > left) {
            if (options.units === undefined) {
              // Everything was already given back: nothing to do, not an error.
              return { kind: 'nothing' as const };
            }
            throw new BadRequestException({
              message: ENTITLEMENT_MESSAGES.REVERSAL_TOO_LARGE,
              code: 'reversal_too_large',
            });
          }

          const entry = await this.repository.insert(tx, {
            organizationId: orgId,
            meter: original.meter,
            units: -wanted,
            kind: UsageKind.REVERSAL,
            idempotencyKey: key,
            refId: original.refId,
            reversesId: original.id,
            cycleStart: original.cycleStart,
            meta: undefined,
            createdBy: null,
          });
          return { kind: 'reversed' as const, entry };
        }, LEDGER_OPTIONS),
      async () => {
        const entry = await this.repository.findByKey(prisma, orgId, key);
        return entry ? { kind: 'duplicate' as const, entry } : null;
      },
    );

    if (outcome.kind === 'nothing') return { entryId, duplicate: true };
    return { entryId: outcome.entry.id, duplicate: outcome.kind === 'duplicate' };
  }

  /**
   * Gives back every charge made for `refId` (a job that failed, was
   * cancelled, or was refused after the download). Safe to call twice.
   * Never throws: a refund that fails is logged for the maintenance sweep.
   */
  async reverseAllFor(orgId: string, refId: string): Promise<number> {
    let reversed = 0;
    try {
      for (const charge of await this.repository.chargesFor(orgId, refId)) {
        const result = await this.reverse(orgId, charge.id);
        if (!result.duplicate) reversed += 1;
      }
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'usage.reverse_failed',
          orgId,
          refId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return reversed;
  }

  /**
   * An operator's correction: one ADJUSTMENT row in the current window
   * (positive uses allowance, negative gives it back). The change log row is
   * written by the operator service in the same request.
   */
  async adjust(
    orgId: string,
    meter: MeterKey,
    units: number,
    options: { reason: string; actorId: string; idempotencyKey?: string; now?: Date },
  ): Promise<UsageEntry> {
    if (!Number.isFinite(units) || units === 0) {
      throw new RangeError('An adjustment must be a non-zero, finite amount.');
    }
    meterDef(meter);
    const window = await this.resolver.windowFor(orgId, meter, options.now ?? new Date());
    const key = options.idempotencyKey ?? `adj:${randomUUID()}`;
    assertKey(key);
    const unitsMilli = units > 0 ? toMilli(units) : -toMilli(-units);

    try {
      return await prisma.usageEntry.create({
        data: {
          organizationId: orgId,
          meter,
          units: unitsMilli,
          kind: UsageKind.ADJUSTMENT,
          idempotencyKey: key,
          refId: null,
          reversesId: null,
          cycleStart: window.start,
          meta: { reason: options.reason.slice(0, 200) },
          createdBy: options.actorId,
        },
      });
    } catch (error) {
      if (isPrismaCode(error, 'P2002')) {
        const existing = await this.repository.findByKey(prisma, orgId, key);
        if (existing) return existing;
      }
      throw this.unavailable('adjust', error);
    }
  }

  /**
   * Module 19: the operator's correction inside the caller's transaction, so
   * the ledger row and its Change Log row commit together or not at all. The
   * same row as `adjust` (an ADJUSTMENT in the window that starts at
   * `cycleStart`, the reason in `meta`), with a key the caller made once per
   * dialog (`adj:<uuid>`). A key already used throws `P2002`, which ends the
   * transaction; the caller answers the existing row as a duplicate.
   */
  async adjustWithin(
    client: Pick<PrismaTransactionClient, 'usageEntry'>,
    orgId: string,
    meter: MeterKey,
    units: number,
    options: { reason: string; actorId: string; idempotencyKey: string; cycleStart: Date },
  ): Promise<UsageEntry> {
    if (!Number.isFinite(units) || units === 0) {
      throw new RangeError('An adjustment must be a non-zero, finite amount.');
    }
    meterDef(meter);
    assertKey(options.idempotencyKey);
    return this.repository.insert(client, {
      organizationId: orgId,
      meter,
      units: units > 0 ? toMilli(units) : -toMilli(-units),
      kind: UsageKind.ADJUSTMENT,
      idempotencyKey: options.idempotencyKey,
      refId: null,
      reversesId: null,
      cycleStart: options.cycleStart,
      meta: { reason: options.reason.slice(0, 200) },
      createdBy: options.actorId,
    });
  }

  /**
   * Runs a ledger transaction with the retry rules: `P2034` retried with a
   * backoff, `P2002` answered by `onDuplicate`, an HTTP refusal thrown
   * inside passed through, anything else a 503.
   */
  private async withRetries<T>(
    label: string,
    run: () => Promise<T>,
    onDuplicate: () => Promise<T | null>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
        if (isPrismaCode(error, 'P2034') && attempt < MAX_RETRIES) {
          this.logger.debug(JSON.stringify({ event: 'usage.retry', action: label, attempt: attempt + 1 }));
          await sleep(RETRY_BACKOFF_MS * (attempt + 1));
          continue;
        }
        if (isPrismaCode(error, 'P2002')) {
          const existing = await onDuplicate().catch(() => null);
          if (existing) return existing;
        }
        throw this.unavailable(label, error);
      }
    }
  }

  private unavailable(label: string, error: unknown): ServiceUnavailableException {
    this.logger.error(
      JSON.stringify({
        event: 'usage.failed',
        action: label,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
    return new ServiceUnavailableException({
      message: ENTITLEMENT_MESSAGES.ALLOWANCE_UNAVAILABLE,
      code: 'allowance_unavailable',
    });
  }
}

function meterDef(meter: MeterKey): Extract<EntitlementDef, { type: 'meter' }> {
  const def = REGISTRY[meter] as EntitlementDef | undefined;
  if (def?.type !== 'meter') throw new RangeError(`${String(meter)} is not a meter.`);
  return def;
}

/** Keys are ours (`clips.import:<uuid>`), short and printable. */
function assertKey(key: string): void {
  if (!/^[A-Za-z0-9._:-]{3,200}$/.test(key)) {
    throw new RangeError('An idempotency key must be 3 to 200 safe characters.');
  }
}

function isPrismaCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
