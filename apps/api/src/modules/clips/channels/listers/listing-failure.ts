/**
 * Why a channel could not be resolved or listed, as one code, whichever
 * binding failed.
 *
 * The bindings throw two kinds of error: the engine's shared
 * `ChannelListerError` (the simulated lister, and the worker's flat lister
 * through its workflow failure) and this `ListingFailure`, which adds the
 * codes only the API's side knows: the YouTube day budget is spent
 * (`quota_exhausted`), an official binding has no working keys
 * (`lister_unconfigured`, which the selector treats like missing keys), the
 * worker did not answer (`tools_offline`), the flat slots are taken
 * (`clips_busy`), or the platform is resting behind the breaker.
 * `toListingFailure` turns anything thrown into one of these, so nothing raw
 * ever reaches a person.
 */
import { ChannelListerError, type ChannelListerErrorCode } from '@postgear/video-engine';

export type ListingFailureCode =
  | ChannelListerErrorCode
  | 'quota_exhausted'
  | 'lister_unconfigured'
  | 'tools_offline'
  | 'clips_busy'
  | 'platform_resting';

const KNOWN: ReadonlySet<string> = new Set<ListingFailureCode>([
  'channel_not_found',
  'channel_listing_failed',
  'platform_changed',
  'platform_rate_limited',
  'list_sort_unsupported',
  'list_kind_unsupported',
  'cancelled',
  'quota_exhausted',
  'lister_unconfigured',
  'tools_offline',
  'clips_busy',
  'platform_resting',
]);

export class ListingFailure extends Error {
  constructor(
    readonly code: ListingFailureCode,
    options: { cause?: unknown } = {},
  ) {
    super(`channel listing failed: ${code}`);
    this.name = 'ListingFailure';
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

export function isListingFailureCode(code: string): code is ListingFailureCode {
  return KNOWN.has(code);
}

/** Anything a binding threw, as a `ListingFailure`. An unknown error is `channel_listing_failed`. */
export function toListingFailure(error: unknown): ListingFailure {
  if (error instanceof ListingFailure) return error;
  if (error instanceof ChannelListerError) return new ListingFailure(error.code, { cause: error });
  return new ListingFailure('channel_listing_failed', { cause: error });
}
