/**
 * The body of `PATCH /discover/settings`: any part of a workspace's Discover
 * settings, and never nothing.
 *
 * Each field is held to the rule the feed's own query holds it to, with the
 * same pieces (`discover.schema.ts`), so whatever is saved here is something
 * the feed takes back without a second look.
 *
 * ## A place is saved whole
 *
 * A country, a region, a city and a zone are one place together. A body that
 * names any of them must name the country and say how the place was found, and
 * the ones it leaves out are written as null (`settings.service.ts`), so a new
 * city can never keep the old city's region.
 *
 * `locationSource` says which of three things the row holds: `NONE` is no place
 * at all and takes no place field with a value; any other source with a null
 * country is Worldwide, saved on purpose; with a country it is that place.
 */
import { DiscoverLocationSource } from '@postgear/db';
import { NEWS_TOPICS } from '@postgear/discover-engine';
import { z } from 'zod';
import type { DiscoverSourceSwitch } from '../discover.plan';
import { countryCode, languageTag, placeName, regionCode, timeZone } from './discover.schema';

/** How many languages a workspace can keep in its order. */
export const MAX_LANGUAGES = 6;

/** The fields that are one place together, saved and cleared as one. */
export const PLACE_FIELDS = [
  'countryCode',
  'regionCode',
  'regionName',
  'city',
  'timeZone',
] as const;

/** `en` and `EN` are one language, and one topic is one topic. */
function hasNoRepeats(values: readonly string[]): boolean {
  return new Set(values.map((value) => value.toLowerCase())).size === values.length;
}

const switchValue = z.boolean().optional();

/** Only the five switches, only booleans. A key nobody knows is refused, not dropped. */
const sources = z
  .object({
    trends: switchValue,
    wikipedia: switchValue,
    social: switchValue,
    videos: switchValue,
    festivals: switchValue,
  } satisfies Record<DiscoverSourceSwitch, typeof switchValue>)
  .strict();

export const updateSettingsSchema = z
  .object({
    countryCode: countryCode.nullable().optional(),
    regionCode: regionCode.nullable().optional(),
    regionName: placeName.nullable().optional(),
    city: placeName.nullable().optional(),
    timeZone: timeZone.nullable().optional(),
    // In the workspace's order: the first is where a member's page starts.
    languages: z.array(languageTag).max(MAX_LANGUAGES).refine(hasNoRepeats).optional(),
    topics: z.array(z.enum(NEWS_TOPICS)).max(NEWS_TOPICS.length).refine(hasNoRepeats).optional(),
    // The whole value every time: a save replaces it, and null is every group on.
    sources: sources.nullable().optional(),
    locationSource: z.nativeEnum(DiscoverLocationSource).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'There is nothing to save.' })
  .superRefine((body, context) => {
    const refuse = (path: string, message: string): void => {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };
    const source = body.locationSource;
    const namesAPlace = PLACE_FIELDS.some((field) => body[field] !== undefined);

    // Languages, topics or switches on their own: no place is being saved.
    if (!namesAPlace && source === undefined) return;

    if (source === undefined) {
      refuse('locationSource', 'A place says how it was found.');
      return;
    }

    if (source === DiscoverLocationSource.NONE) {
      // Clearing: nothing of a place may come with it.
      if (PLACE_FIELDS.some((field) => body[field] != null)) {
        refuse('locationSource', 'No place takes no country, region, city or zone.');
      }
      return;
    }

    if (body.countryCode === undefined) {
      refuse('countryCode', 'A place is saved whole, starting with its country.');
      return;
    }

    if (body.countryCode === null) {
      // Worldwide, saved on purpose.
      if (body.regionCode != null || body.regionName != null || body.city != null) {
        refuse('countryCode', 'A region or a city needs its country.');
      }
      return;
    }

    if (body.regionCode != null && !body.regionCode.startsWith(`${body.countryCode}-`)) {
      refuse('regionCode', 'The region is not in that country.');
    }
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
