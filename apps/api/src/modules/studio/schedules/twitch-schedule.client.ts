/**
 * A week of a Twitch schedule through Helix (Sprint 13, Module 14 section C3;
 * verified 2026-11-17 on dev.twitch.tv/docs/api/reference/schedule).
 *
 * - `Get Users?login=` for the broadcaster id; no user is `no_user`.
 * - `Get Channel Stream Schedule?broadcaster_id=` with `start_time` at the
 *   window's start and `first=25`, following `pagination.cursor` while the
 *   page's last stream starts before the window's end (at most four pages,
 *   a hundred streams, far more than a week holds).
 * - A 404 from the schedule call is `no_schedule`: Twitch answers that for a
 *   channel with no schedule and for one with no streams in it.
 * - The app token is the channel browser's (`TwitchAppToken`, the same Redis
 *   key), so the two never fetch two tokens. A 401 drops it and the call is
 *   tried once more with a new one.
 * - Requests go through the channel listers' HTTP door (`createListerHttp`):
 *   only `api.twitch.tv` and `id.twitch.tv`, no redirects, a timeout and a
 *   body cap.
 * - **Never logged or thrown**: the client secret, the token, an address or
 *   Twitch's own error words. A failure is a `ScheduleFetchFailure` code.
 */
import { z } from 'zod';
import type { ListerHttp } from '../../clips/channels/listers/lister-http';
import { ListingFailure } from '../../clips/channels/listers/listing-failure';
import type { TwitchAppToken } from '../../clips/channels/listers/twitch-app-token';
import {
  type Broadcaster,
  plainText,
  ScheduleFetchFailure,
  type ScheduleOutcome,
  type ScheduleRequest,
  type ScheduleSource,
} from './schedule-source';

const HELIX = 'https://api.twitch.tv/helix';
const PAGE_SIZE = '25';
const MAX_PAGES = 4;

const isoInstant = z.string().refine((value) => !Number.isNaN(Date.parse(value)));

const usersSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().regex(/^\d{1,20}$/),
      login: z.string().max(64),
      display_name: z.string().max(200),
    }),
  ),
});

const scheduleSchema = z.object({
  data: z.object({
    segments: z
      .array(
        z.object({
          start_time: isoInstant,
          end_time: isoInstant.nullable().optional(),
          title: z.string().max(2_000).nullable().optional(),
          canceled_until: isoInstant.nullable().optional(),
          category: z
            .object({ name: z.string().max(2_000) })
            .nullable()
            .optional(),
          is_recurring: z.boolean().optional(),
        }),
      )
      .nullable()
      .optional(),
    broadcaster_login: z.string().max(64).optional(),
    broadcaster_name: z.string().max(200).optional(),
    vacation: z.object({ start_time: isoInstant, end_time: isoInstant }).nullable().optional(),
  }),
  pagination: z.object({ cursor: z.string().max(512).optional() }).optional(),
});

type HelixAnswer = { status: 200; json: unknown } | { status: 404 };

export interface TwitchScheduleClientOptions {
  token: TwitchAppToken;
  http: ListerHttp;
}

export class TwitchScheduleClient implements ScheduleSource {
  readonly mode = 'helix' as const;

  constructor(private readonly options: TwitchScheduleClientOptions) {}

  async fetch(request: ScheduleRequest): Promise<ScheduleOutcome> {
    const users = await this.helix('/users', { login: request.login }, request.signal);
    if (users.status === 404) return { kind: 'no_user' };
    const user = parse(usersSchema, users.json).data[0];
    if (!user) return { kind: 'no_user' };

    const broadcaster: Broadcaster = {
      login: user.login.toLowerCase(),
      displayName: plainText(user.display_name) || user.login,
    };

    const endMs = request.window.end.getTime();
    const startMs = request.window.start.getTime();
    const segments: Extract<ScheduleOutcome, { kind: 'found' }>['segments'] = [];
    let vacation: Extract<ScheduleOutcome, { kind: 'found' }>['vacation'] = null;
    let cursor: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const params: Record<string, string> = {
        broadcaster_id: user.id,
        start_time: request.window.start.toISOString(),
        first: PAGE_SIZE,
      };
      if (cursor) params.after = cursor;

      const answer = await this.helix('/schedule', params, request.signal);
      if (answer.status === 404) {
        // No schedule at all, or none from here on: on the first page that is the answer.
        if (page === 0) return { kind: 'no_schedule', broadcaster };
        break;
      }
      const body = parse(scheduleSchema, answer.json);
      if (page === 0 && body.data.vacation) {
        vacation = { start: body.data.vacation.start_time, end: body.data.vacation.end_time };
      }

      const listed = body.data.segments ?? [];
      for (const segment of listed) {
        const at = Date.parse(segment.start_time);
        if (at < startMs || at >= endMs) continue;
        segments.push({
          start: new Date(at).toISOString(),
          end: segment.end_time ? new Date(Date.parse(segment.end_time)).toISOString() : null,
          title: plainText(segment.title ?? ''),
          category: segment.category ? plainText(segment.category.name) || null : null,
          canceledUntil: segment.canceled_until
            ? new Date(Date.parse(segment.canceled_until)).toISOString()
            : null,
          recurring: segment.is_recurring === true,
        });
      }

      cursor = body.pagination?.cursor;
      const last = listed.at(-1);
      if (!cursor || !last || Date.parse(last.start_time) >= endMs) break;
    }

    if (segments.length === 0 && vacation === null) return { kind: 'no_schedule', broadcaster };
    return { kind: 'found', broadcaster, segments, vacation };
  }

  /** One Helix call with the app token, one retry on a 401, statuses as codes. */
  private async helix(
    path: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<HelixAnswer> {
    const url = `${HELIX}${path}?${new URLSearchParams(params).toString()}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.token(attempt > 0);
      let response: Awaited<ReturnType<ListerHttp>>;
      try {
        response = await this.options.http({
          url,
          headers: {
            'Client-Id': this.options.token.clientId,
            Authorization: `Bearer ${token}`,
          },
          signal,
        });
      } catch {
        throw new ScheduleFetchFailure('upstream_failed');
      }

      if (response.status === 200) return { status: 200, json: response.json };
      // A malformed login fails `Get Users` with a 400: we checked it first, so it is a miss.
      if (response.status === 404 || (response.status === 400 && path === '/users')) {
        return { status: 404 };
      }
      if (response.status === 401 && attempt === 0) {
        await this.options.token.drop();
        continue;
      }
      if (response.status === 429) throw new ScheduleFetchFailure('rate_limited');
      if (response.status === 401 || response.status === 403) {
        throw new ScheduleFetchFailure('unconfigured');
      }
      throw new ScheduleFetchFailure('upstream_failed');
    }
    throw new ScheduleFetchFailure('unconfigured');
  }

  private async token(fresh: boolean): Promise<string> {
    try {
      return await this.options.token.get(fresh);
    } catch (error) {
      if (error instanceof ListingFailure) {
        if (error.code === 'lister_unconfigured') throw new ScheduleFetchFailure('unconfigured');
        if (error.code === 'platform_rate_limited') throw new ScheduleFetchFailure('rate_limited');
      }
      throw new ScheduleFetchFailure('upstream_failed');
    }
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ScheduleFetchFailure('platform_changed');
  return parsed.data;
}
