/**
 * The weekly Discover digest (Sprint 11 Module 10, backlog #15).
 *
 * An admin turns it on in Discover's settings (`weeklyDigest`). On Monday
 * between 08:00 and 10:00 in the workspace's own time zone, the worker's
 * maintenance run asks this service to send what is due: the top trends, the
 * top stories and the next festival for the workspace's saved place, as one
 * `discover.digest` notification. The notifications outbox then emails every
 * member who kept `sendDigestEmails` on, the same way every other email goes.
 *
 * A week is claimed before anything is read (`digestSentAt` moves in one
 * conditional update), so two runs at once, or a run that is retried, can
 * never send a workspace two digests. A digest that cannot be put together
 * gives the claim back, so the next hour in the window tries again.
 *
 * It reads the same shared feed copies a person's page reads, so a digest
 * costs nothing a look at the page would not.
 */
import { Injectable, Logger } from '@nestjs/common';
import { buildLocality, type Locality, WORLDWIDE } from '@postgear/discover-engine';
import { NotificationsService } from '../notifications/notifications.service';
import { DiscoverService, type FeedAnswer } from './discover.service';
import { DiscoverSettingsRepository, type DigestCandidate } from './settings.repository';

/** Monday, from 08:00 to before 10:00, in the place's zone. */
const DIGEST_WEEKDAY = 'Mon';
const DIGEST_FROM_HOUR = 8;
const DIGEST_UNTIL_HOUR = 10;
/** A digest is due again once this long has passed since the last one. */
const DIGEST_EVERY_MS = 6 * 24 * 60 * 60 * 1000;
const PER_RUN = 50;
const TRENDS = 3;
const STORIES = 3;

/** The weekday (`Mon`) and hour (0 to 23) it is now in a time zone. UTC when the zone is unknown. */
export function localClock(now: Date, timeZone: string | null): { weekday: string; hour: number } {
  const read = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      hour: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(now);
    const weekday = parts.find((part) => part.type === 'weekday')?.value ?? '';
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? Number.NaN);
    return { weekday, hour };
  };
  try {
    return read(timeZone ?? 'UTC');
  } catch {
    return read('UTC');
  }
}

export function isDigestHour(now: Date, timeZone: string | null): boolean {
  const { weekday, hour } = localClock(now, timeZone);
  return weekday === DIGEST_WEEKDAY && hour >= DIGEST_FROM_HOUR && hour < DIGEST_UNTIL_HOUR;
}

function localityOf(row: DigestCandidate): Locality {
  if (!row.countryCode) return { ...WORLDWIDE };
  return buildLocality({
    countryCode: row.countryCode,
    regionCode: row.regionCode,
    regionName: row.regionName,
    city: row.city,
    timeZone: row.timeZone,
  });
}

function placeName(locality: Locality): string {
  return locality.city ?? locality.regionName ?? locality.countryName ?? 'the world';
}

function firstItems(answer: FeedAnswer | null, count: number) {
  return (answer?.groups ?? []).flatMap((group) => group.items).slice(0, count);
}

@Injectable()
export class DiscoverDigestService {
  private readonly logger = new Logger(DiscoverDigestService.name);

  constructor(
    private readonly settings: DiscoverSettingsRepository,
    private readonly discover: DiscoverService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Sends every digest due at `now`. Answers how many went out. Never throws for one workspace. */
  async sendDue(now: Date = new Date()): Promise<{ sent: number; checked: number }> {
    const since = new Date(now.getTime() - DIGEST_EVERY_MS);
    const candidates = await this.settings.digestCandidates(since, PER_RUN * 4);
    const due = candidates.filter((row) => isDigestHour(now, row.timeZone)).slice(0, PER_RUN);

    let sent = 0;
    for (const row of due) {
      try {
        if (await this.sendOne(row, since, now)) sent += 1;
      } catch (error) {
        this.logger.warn(
          JSON.stringify({
            event: 'discover.digest.failed',
            orgId: row.organizationId,
            reason: error instanceof Error ? error.name : 'unknown',
          }),
        );
      }
    }
    return { sent, checked: due.length };
  }

  private async sendOne(row: DigestCandidate, since: Date, now: Date): Promise<boolean> {
    const orgId = row.organizationId;
    if (!(await this.settings.claimDigest(orgId, since, now))) return false;

    try {
      const highlights = await this.highlights(orgId, row);
      if (highlights.lines.length === 0) {
        await this.settings.releaseDigest(orgId, now, row.digestSentAt);
        return false;
      }

      await this.notifications.notify({
        organizationId: orgId,
        type: 'discover.digest',
        content: `What is rising in ${highlights.place} this week, from Discover.`,
        link: `/${orgId}/discover`,
        meta: { place: highlights.place, highlights: highlights.lines },
      });
      return true;
    } catch (error) {
      await this.settings.releaseDigest(orgId, now, row.digestSentAt).catch(() => undefined);
      throw error;
    }
  }

  private async highlights(
    orgId: string,
    row: DigestCandidate,
  ): Promise<{ place: string; lines: string[] }> {
    const locality = localityOf(row);
    const language = row.languages[0] ?? locality.languages[0] ?? 'en';
    const ask = (kind: 'trending' | 'news' | 'festivals') =>
      this.discover
        .feed(orgId, { kind, locality, language, workspaceSources: true })
        .catch(() => null);

    const [trending, news, festivals] = await Promise.all([
      ask('trending'),
      ask('news'),
      locality.countryCode ? ask('festivals') : Promise.resolve(null),
    ]);

    const lines: string[] = [];
    for (const item of firstItems(trending, TRENDS)) {
      lines.push(item.signal?.label ? `Trending: ${item.title} (${item.signal.label})` : `Trending: ${item.title}`);
    }
    for (const item of firstItems(news, STORIES)) {
      lines.push(`In the news: ${item.title} (${item.source.name})`);
    }
    const festival = firstItems(festivals, 1)[0];
    if (festival) {
      lines.push(festival.date ? `Coming up: ${festival.title} on ${festival.date}` : `Coming up: ${festival.title}`);
    }
    return { place: placeName(locality), lines };
  }
}
