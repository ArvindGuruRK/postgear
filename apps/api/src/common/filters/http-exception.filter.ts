import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { AUTH_MESSAGES } from '../../modules/auth/auth.messages';
import { reportUnexpectedError } from '../sentry/sentry';

/**
 * The single exit point for every error response.
 *
 * Without it, three things leak by default:
 *
 *  1. **Nest's own shape.** A `BadRequestException` thrown with a string
 *     produces `{ statusCode, message, error }`, and one thrown by a
 *     validation pipe produces `message` as an *array of per-field strings*:
 *     exactly the field-level detail the requirement forbids.
 *  2. **Prisma errors.** An unhandled `PrismaClientKnownRequestError` renders
 *     its `meta.target`, which names the column that collided. On a
 *     registration conflict that is a direct "this email is already
 *     registered" disclosure.
 *  3. **Stack traces**, in any non-HttpException.
 *
 * So the filter normalises everything to `{ error, statusCode }` with a
 * message drawn from the catalogue, and logs the real cause server-side.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<{
      method: string;
      url: string;
      user?: { id: string };
      activeOrg?: { id: string };
    }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string = AUTH_MESSAGES.UNEXPECTED;
    let code: string | null = null;
    let details: Record<string, number> | null = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = normalizeMessage(exception.getResponse());
      code = normalizeCode(exception.getResponse());
      details = code ? normalizeDetails(exception.getResponse()) : null;
    } else {
      // Anything not deliberately thrown as an HttpException is a bug or a
      // driver-level failure. The client gets the generic string; the stack
      // goes to the log, which is the only place it belongs, and to Sentry
      // when a DSN is configured (Sprint 8), which is where a bug in
      // production is actually seen.
      this.logger.error(
        `Unhandled ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      reportUnexpectedError(exception, {
        method: request.method,
        url: request.url,
        userId: request.user?.id,
        orgId: request.activeOrg?.id,
      });
    }

    response.status(status).json({
      error: message,
      statusCode: status,
      ...(code ? { code } : {}),
      ...(details ? { details } : {}),
    });
  }
}

/**
 * Numbers a coded refusal chose to carry, such as the current revision on a
 * workflow save conflict (Sprint 10), so the client can act without a second
 * request. Whole numbers under short identifier keys only: nothing here can
 * carry text, so nothing here can leak the detail this filter hides.
 */
function normalizeDetails(body: string | object): Record<string, number> | null {
  if (typeof body !== 'object') {
    return null;
  }

  const raw = (body as { details?: unknown }).details;

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }

  const details = Object.fromEntries(
    Object.entries(raw).filter(
      ([key, value]) => /^[a-zA-Z][a-zA-Z0-9]{0,31}$/.test(key) && Number.isSafeInteger(value),
    ),
  ) as Record<string, number>;

  return Object.keys(details).length > 0 ? details : null;
}

/**
 * A machine-readable `code` an exception chose to carry (e.g. the appearance
 * routes' `premium_theme_requires_plan`), so a client can branch on the kind
 * of refusal without matching on copy. Only a deliberate snake_case
 * identifier passes, never free text, which could carry the detail this
 * filter exists to keep out of responses.
 */
function normalizeCode(body: string | object): string | null {
  if (typeof body !== 'object') {
    return null;
  }

  const code = (body as { code?: unknown }).code;

  return typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : null;
}

/**
 * Flattens whatever Nest put in the exception body down to one safe string.
 *
 * The array case is Nest's built-in ValidationPipe format. Reaching it means
 * some route bypassed `ZodBody`: the array is discarded rather than joined,
 * because joining it would emit precisely the per-field detail the auth
 * requirements prohibit.
 */
function normalizeMessage(body: string | object): string {
  if (typeof body === 'string') {
    return body;
  }

  const message = (body as { message?: unknown }).message;

  if (typeof message === 'string') {
    return message;
  }

  if (Array.isArray(message)) {
    return AUTH_MESSAGES.INVALID_INPUT;
  }

  return AUTH_MESSAGES.UNEXPECTED;
}
