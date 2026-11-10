/**
 * Persistence for a workspace's Discover settings, and the only reader and
 * writer of the `DiscoverSettings` table.
 *
 * One row per workspace at most, and the workspace's own id is the key. Both
 * queries here name it and nothing else, so there is no way to reach another
 * workspace's row. No row means nothing was ever saved, which is an answer and
 * not an error.
 *
 * A save is a single upsert: there is never a moment with half a place in the
 * row, and two admins saving two different cards at once each change only the
 * columns they sent.
 */
import { Injectable } from '@nestjs/common';
import { type DiscoverLocationSource, Prisma, prisma } from '@postgear/db';

export interface SettingsRow {
  countryCode: string | null;
  regionCode: string | null;
  regionName: string | null;
  city: string | null;
  timeZone: string | null;
  languages: string[];
  topics: string[];
  /** Whatever the column holds. A row can be edited by hand, so the service reads it key by key. */
  sources: unknown;
  locationSource: DiscoverLocationSource;
  updatedAt: Date;
}

/** The columns a save may change. A key that is left out is left alone. */
export interface SettingsPatch {
  countryCode?: string | null;
  regionCode?: string | null;
  regionName?: string | null;
  city?: string | null;
  timeZone?: string | null;
  languages?: string[];
  topics?: string[];
  /** Null puts every group back on. */
  sources?: Record<string, boolean> | null;
  locationSource?: DiscoverLocationSource;
}

const SETTINGS_SELECT = {
  countryCode: true,
  regionCode: true,
  regionName: true,
  city: true,
  timeZone: true,
  languages: true,
  topics: true,
  sources: true,
  locationSource: true,
  updatedAt: true,
} as const;

/** Column by column, so nothing that is not a column of this table can ride along. */
function columnsOf(patch: SettingsPatch) {
  return {
    countryCode: patch.countryCode,
    regionCode: patch.regionCode,
    regionName: patch.regionName,
    city: patch.city,
    timeZone: patch.timeZone,
    languages: patch.languages,
    topics: patch.topics,
    // A JSON column is emptied with Prisma's own null, never with a bare one.
    sources: patch.sources === null ? Prisma.DbNull : patch.sources,
    locationSource: patch.locationSource,
  };
}

@Injectable()
export class DiscoverSettingsRepository {
  /** The workspace's row, or null when nothing was ever saved. */
  async find(orgId: string): Promise<SettingsRow | null> {
    return prisma.discoverSettings.findUnique({
      where: { organizationId: orgId },
      select: SETTINGS_SELECT,
    });
  }

  /** Creates the row on the first save and changes it on every later one, noting who saved. */
  async upsert(orgId: string, userId: string, patch: SettingsPatch): Promise<SettingsRow> {
    const columns = { ...columnsOf(patch), updatedById: userId };

    return prisma.discoverSettings.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, ...columns },
      update: columns,
      select: SETTINGS_SELECT,
    });
  }
}
