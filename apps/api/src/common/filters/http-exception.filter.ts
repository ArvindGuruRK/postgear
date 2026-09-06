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

/**
 * The single exit point for every error response.
 *
 * Without it, three things leak by default:
 *
 *  1. **Nest's own shape.** A `BadRequestException` thrown with a string
 *     produces `{ statusCode, message, error }`, and one thrown by a
 *     validation pipe produces `message` as an *array of per-field strings* —
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
    const request = host.switchToHttp().getRequest<{ method: string; url: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string = AUTH_MESSAGES.UNEXPECTED;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = normalizeMessage(exception.getResponse());
    } else {
      // Anything not deliberately thrown as an HttpException is a bug or a
      // driver-level failure. The client gets the generic string; the stack
      // goes to the log, which is the only place it belongs.
      this.logger.error(
        `Unhandled ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({ error: message, statusCode: status });
  }
}

/**
 * Flattens whatever Nest put in the exception body down to one safe string.
 *
 * The array case is Nest's built-in ValidationPipe format. Reaching it means
 * some route bypassed `ZodBody` — the array is discarded rather than joined,
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
