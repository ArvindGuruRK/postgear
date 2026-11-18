/**
 * `/clips/files/<token>` (Sprint 12, Module 02): the private space's files,
 * served by signed link on the local storage binding.
 *
 * The token is the authority, so the route is `@Public()`: a `<video>`
 * element or a download link cannot send our cookie across ports reliably,
 * and the link itself names one key, one purpose and an expiry, signed with
 * HMAC-SHA256 and checked in constant time. A key without a valid token is
 * never reachable. With the S3 binding the browser gets presigned bucket
 * addresses instead and this route answers 404 to everything.
 *
 * - `GET` serves the file with `Range` (players seek), `206` and
 *   `Content-Range`, `416` for a range past the end, the content type from
 *   the key's extension (never sniffed), and `Content-Disposition` when the
 *   link was made for a download.
 * - `PUT` takes one part of a browser upload (Module 04) to a part link.
 *
 * Every failure of the token reads the same (403), so nothing tells an
 * expired link from a forged one. `@SkipThrottle()`: a player makes many
 * small range requests for one video.
 */
import { pipeline } from 'node:stream/promises';
import { Controller, Get, HttpStatus, Inject, Logger, Param, Put, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  contentDispositionFor,
  contentTypeForClipKey,
  LocalPrivateStorage,
  type PrivateStorage,
  parseRangeHeader,
  StorageNotFoundError,
  StorageRangeError,
  StorageUploadError,
} from '@postgear/storage';
import type { Request, Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';
import { CLIPS_MESSAGES } from '../clips.messages';

/** A token is base64url with one dot; anything longer is not ours. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,2048}\.[A-Za-z0-9_-]{16,128}$/;

@Controller('clips/files')
@Public()
@SkipThrottle()
export class ClipFilesController {
  private readonly logger = new Logger(ClipFilesController.name);

  constructor(@Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage) {}

  @Get(':token')
  async get(
    @Param('token') token: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const local = this.localBinding();
    if (!local) return this.refuse(response, HttpStatus.NOT_FOUND, CLIPS_MESSAGES.FILE_NOT_FOUND);

    const verified = TOKEN_PATTERN.test(token) ? local.verify(token) : null;
    if (!verified?.ok || verified.claims.purpose !== 'get') {
      return this.refuse(response, HttpStatus.FORBIDDEN, CLIPS_MESSAGES.FILE_LINK_INVALID);
    }
    const { key, downloadName } = verified.claims;

    const stat = await local.stat(key);
    if (!stat) return this.refuse(response, HttpStatus.NOT_FOUND, CLIPS_MESSAGES.FILE_NOT_FOUND);

    const range = parseRangeHeader(headerOf(request, 'range'), stat.bytes);
    if (range === 'unsatisfiable') return this.unsatisfiable(response, stat.bytes);

    let object: Awaited<ReturnType<LocalPrivateStorage['getStream']>>;
    try {
      object = await local.getStream(key, range ?? undefined);
    } catch (error) {
      // The file was replaced between stat and open, and is now shorter.
      if (error instanceof StorageRangeError) {
        const now = await local.stat(key);
        return this.unsatisfiable(response, now?.bytes ?? 0);
      }
      throw error;
    }
    if (!object) return this.refuse(response, HttpStatus.NOT_FOUND, CLIPS_MESSAGES.FILE_NOT_FOUND);

    response.status(object.range ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK);
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Content-Type', contentTypeForClipKey(key));
    response.setHeader('Content-Length', String(object.bytes));
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (object.range) {
      response.setHeader(
        'Content-Range',
        `bytes ${object.range.start}-${object.range.end}/${object.totalBytes}`,
      );
    }
    if (downloadName) {
      response.setHeader('Content-Disposition', contentDispositionFor(downloadName));
    }

    try {
      await pipeline(object.body, response);
    } catch (error) {
      // A player that seeks closes the connection mid-file: normal, not an error.
      if (!response.writableEnded && !isClientGone(error)) {
        this.logger.warn(
          JSON.stringify({
            event: 'clips.files.stream_failed',
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      object.body.destroy();
      if (!response.headersSent) response.status(HttpStatus.INTERNAL_SERVER_ERROR).end();
      else response.destroy();
    }
  }

  /** One part of a browser upload, to a part link from `signPart`. Answers its ETag. */
  @Put(':token')
  async putPart(
    @Param('token') token: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const local = this.localBinding();
    if (!local) return this.refuse(response, HttpStatus.NOT_FOUND, CLIPS_MESSAGES.FILE_NOT_FOUND);

    const verified = TOKEN_PATTERN.test(token) ? local.verify(token) : null;
    if (!verified?.ok || verified.claims.purpose !== 'part') {
      return this.refuse(response, HttpStatus.FORBIDDEN, CLIPS_MESSAGES.FILE_LINK_INVALID);
    }
    const { key, uploadId, partNumber } = verified.claims;

    try {
      const part = await local.receivePart(key, uploadId, partNumber, request);
      response.setHeader('ETag', part.etag);
      response.status(HttpStatus.OK).end();
    } catch (error) {
      if (error instanceof StorageNotFoundError) {
        return this.refuse(response, HttpStatus.NOT_FOUND, CLIPS_MESSAGES.upload_incomplete);
      }
      if (error instanceof StorageUploadError) {
        return this.refuse(response, HttpStatus.BAD_REQUEST, CLIPS_MESSAGES.upload_incomplete);
      }
      throw error;
    }
  }

  private localBinding(): LocalPrivateStorage | null {
    return this.storage instanceof LocalPrivateStorage ? this.storage : null;
  }

  private unsatisfiable(response: Response, totalBytes: number): void {
    response.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
    response.setHeader('Content-Range', `bytes */${totalBytes}`);
    response.end();
  }

  private refuse(response: Response, status: HttpStatus, message: string): void {
    response.status(status).json({ error: message, statusCode: status });
  }
}

function headerOf(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function isClientGone(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ECONNRESET' || code === 'EPIPE';
}
