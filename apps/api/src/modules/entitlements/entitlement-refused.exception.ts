/**
 * A plan limit said no (Sprint 12, research 12 section 6.3).
 *
 * A 402 whose body is `{ message, code, details }`, the shape the global
 * exception filter passes through unchanged: `code` is the key's
 * `refusalCode` (snake_case, so the filter keeps it) and `details` holds
 * whole numbers only (`limit`, `used`, `needed`, `remaining`), in display
 * units. The key itself is never sent; the code names it. This is the
 * pattern of `PremiumLookRequiredException`, and the web turns the code into
 * the lock dialog with See Plans.
 */
import { HttpException, HttpStatus } from '@nestjs/common';

export interface RefusalDetails {
  limit?: number | null;
  used?: number;
  needed?: number;
  remaining?: number | null;
}

export class EntitlementRefusedException extends HttpException {
  constructor(
    readonly refusalCode: string,
    message: string,
    details: RefusalDetails = {},
  ) {
    super(
      { message, code: refusalCode, details: wholeNumbers(details) },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/** Only finite values, as whole numbers; unlimited (null) is left out. */
function wholeNumbers(details: RefusalDetails): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(details)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[name] = Math.max(0, Math.round(value));
    }
  }
  return out;
}
