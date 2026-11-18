/**
 * A Clips refusal with our `code` (Sprint 12).
 *
 * The body is `{ message, code }`, the shape the global exception filter
 * passes through as `{ error, code }`, so the web reads `ApiError.code` and
 * branches without matching on copy. The message comes from the engine's
 * sentence for the code (or one given explicitly), never from a tool.
 */
import { HttpException, type HttpStatus } from '@nestjs/common';
import { type ClipPlatformId, clipErrorMessage } from '@postgear/video-engine';

export class ClipErrorException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly clipCode: string,
    options: { platform?: ClipPlatformId; message?: string; details?: Record<string, number> } = {},
  ) {
    super(
      {
        message: options.message ?? clipErrorMessage(clipCode, options.platform),
        code: clipCode,
        ...(options.details ? { details: options.details } : {}),
      },
      status,
    );
  }
}
