/**
 * A workspace's Discover settings: the place its members start from, in which
 * languages, with which news topics, and which groups it has switched off.
 *
 * This is the one part of Discover that belongs to a workspace. The feed's
 * copies stay everyone's (`discover.service.ts`); what is kept here only decides
 * where a member's page starts and which groups their own requests ask for.
 *
 * ## Who may change it
 *
 * Any member reads it, because their page starts from it. Only an admin changes
 * it. The route lets members through the role guard on purpose: the guard can
 * only answer in its own general words, and this refusal has a sentence of its
 * own. So it is made here, before anything is read or written, and no row is
 * created by an attempt.
 *
 * ## A place is saved whole
 *
 * A save that names a place (the body says how it was found) writes all five
 * place fields, the ones it left out as null. Languages, topics and switches are
 * each replaced only when they are sent.
 *
 * ## The row is not trusted
 *
 * `sources` is JSON, and a row can be edited by hand. It is read key by key:
 * only the five switches, only booleans. Anything else in it is as if it were
 * not there, so it can neither break a feed request nor switch off something
 * nobody meant. The place that is answered is built here from the stored codes
 * and is never stored itself.
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { DiscoverLocationSource, Role } from '@postgear/db';
import { buildLocality, isNewsTopic, WORLDWIDE } from '@postgear/discover-engine';
import type { ActiveOrg } from '../../common/decorators/current-org.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { securityLogger } from '../../common/logging/security-logger';
import { DISCOVER_MESSAGES } from './discover.messages';
import { type DiscoverSourceSwitch, SOURCE_SWITCHES } from './discover.plan';
import { PLACE_FIELDS, type UpdateSettingsInput } from './dto/settings.schema';
import { type LocalityAnswer, withNewsLanguages } from './locality.service';
import {
  DiscoverSettingsRepository,
  type SettingsPatch,
  type SettingsRow,
} from './settings.repository';

/** A missing switch is on. */
export type DiscoverSources = Partial<Record<DiscoverSourceSwitch, boolean>>;

export interface DiscoverSettingsAnswer {
  /** Null with `locationSource: 'NONE'` means never saved; null with any other source means Worldwide was saved. */
  countryCode: string | null;
  regionCode: string | null;
  regionName: string | null;
  city: string | null;
  timeZone: string | null;
  /** BCP-47, in the workspace's order. The first is the default. */
  languages: string[];
  /** Google News topic ids. The first is the News tab's default. */
  topics: string[];
  /** Null means every group is on. */
  sources: DiscoverSources | null;
  locationSource: DiscoverLocationSource;
  /** The saved place as every Discover answer carries a place. Null when none was ever saved. */
  place: LocalityAnswer | null;
  /** ISO 8601, null when never saved. */
  updatedAt: string | null;
}

/** What a workspace that never saved anything has. */
function neverSaved(): DiscoverSettingsAnswer {
  return {
    countryCode: null,
    regionCode: null,
    regionName: null,
    city: null,
    timeZone: null,
    languages: [],
    topics: [],
    sources: null,
    locationSource: DiscoverLocationSource.NONE,
    place: null,
    updatedAt: null,
  };
}

/**
 * The switches in a stored value, and nothing else that may be in it. Null when
 * it is not an object at all, which reads as every group on.
 */
function readSources(stored: unknown): DiscoverSources | null {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return null;

  const sources: DiscoverSources = {};
  for (const id of SOURCE_SWITCHES) {
    const value = Object.hasOwn(stored, id) ? (stored as Record<string, unknown>)[id] : undefined;
    if (typeof value === 'boolean') sources[id] = value;
  }
  return sources;
}

/**
 * The saved place, with its names and languages filled the way every other
 * place is. A zone that was stored is handed on as stored.
 */
function placeOf(row: SettingsRow): LocalityAnswer | null {
  if (row.locationSource === DiscoverLocationSource.NONE) return null;
  // A source and no country: Worldwide, saved on purpose.
  if (!row.countryCode) return withNewsLanguages({ ...WORLDWIDE, timeZone: row.timeZone });

  return withNewsLanguages(
    buildLocality({
      countryCode: row.countryCode,
      regionCode: row.regionCode,
      regionName: row.regionName,
      city: row.city,
      timeZone: row.timeZone,
    }),
  );
}

function answerOf(row: SettingsRow): DiscoverSettingsAnswer {
  return {
    countryCode: row.countryCode,
    regionCode: row.regionCode,
    regionName: row.regionName,
    city: row.city,
    timeZone: row.timeZone,
    languages: row.languages,
    // The page sends the first of these back as the feed's topic, so only real ones leave.
    topics: row.topics.filter(isNewsTopic),
    sources: readSources(row.sources),
    locationSource: row.locationSource,
    place: placeOf(row),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * What a body changes in the row. The body's shape was checked on the way in
 * (`dto/settings.schema.ts`): a place always arrives with how it was found, so
 * that is what marks a save as one of the place.
 */
function patchOf(input: UpdateSettingsInput): SettingsPatch {
  const patch: SettingsPatch = {};

  if (input.locationSource !== undefined) {
    patch.locationSource = input.locationSource;
    // Whole: what the body left out is cleared, so a new city never keeps the old region.
    for (const field of PLACE_FIELDS) patch[field] = input[field] ?? null;
  }
  if (input.languages !== undefined) patch.languages = input.languages;
  if (input.topics !== undefined) patch.topics = input.topics;
  if (input.sources !== undefined) patch.sources = input.sources;

  return patch;
}

@Injectable()
export class DiscoverSettingsService {
  constructor(private readonly repository: DiscoverSettingsRepository) {}

  /** The workspace's settings, or what a workspace that never saved any has. */
  async get(orgId: string): Promise<DiscoverSettingsAnswer> {
    const row = await this.repository.find(orgId);
    return row ? answerOf(row) : neverSaved();
  }

  /** Saves what the body names, for an admin. A member is refused before anything is touched. */
  async update(
    org: ActiveOrg,
    user: AuthenticatedUser,
    input: UpdateSettingsInput,
  ): Promise<DiscoverSettingsAnswer> {
    this.assertAdmin(org, user);
    return answerOf(await this.repository.upsert(org.id, user.id, patchOf(input)));
  }

  /**
   * The groups this workspace has switched off, for the feed. One read by the
   * row's key, and not cached: a switch an admin just flipped holds on the very
   * next request.
   */
  async switchedOff(orgId: string): Promise<DiscoverSourceSwitch[]> {
    const row = await this.repository.find(orgId);
    const sources = readSources(row?.sources);
    return SOURCE_SWITCHES.filter((id) => sources?.[id] === false);
  }

  /** An admin of the workspace, or a super admin acting in it. */
  private assertAdmin(org: ActiveOrg, user: AuthenticatedUser): void {
    if (org.role === Role.ADMIN || org.role === Role.SUPERADMIN || user.isSuperAdmin) return;

    // The guard's own event for a wrong role, in its shape, so one search finds both.
    securityLogger.warn('rbac.denied', {
      userId: user.id,
      orgId: org.id,
      role: org.role,
      required: [Role.ADMIN],
      route: 'discover/settings',
    });
    throw new ForbiddenException({
      message: DISCOVER_MESSAGES.settingsAdminOnly,
      code: 'settings_admin_only',
    });
  }
}
