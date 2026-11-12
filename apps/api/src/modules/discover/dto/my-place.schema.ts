/**
 * `PUT /discover/my-place` (Sprint 11 Module 10, backlog #6): the place one
 * member last chose, kept for them in this workspace so it follows them to
 * another browser. The whole place every time: a save replaces it.
 *
 * Also the bodies and queries of the place helpers that came with it: the
 * country and region lists the picker offers when no place finder is set up.
 */
import { DiscoverLocationSource } from '@postgear/db';
import { NEWS_TOPICS } from '@postgear/discover-engine';
import { z } from 'zod';
import { countryCode, languageTag, placeName, regionCode, timeZone } from './discover.schema';

export const myPlaceSchema = z
  .object({
    countryCode: countryCode.nullable(),
    regionCode: regionCode.nullable(),
    regionName: placeName.nullable(),
    city: placeName.nullable(),
    timeZone: timeZone.nullable(),
    language: languageTag.nullable(),
    // 'ALL' is a choice of its own (All beats the workspace's topic once picked).
    topic: z.union([z.enum(NEWS_TOPICS), z.literal('ALL')]).nullable(),
    locationSource: z.nativeEnum(DiscoverLocationSource),
  })
  .strict()
  .refine((body) => body.countryCode || (!body.regionCode && !body.regionName && !body.city), {
    path: ['countryCode'],
    message: 'A region or a city needs its country.',
  })
  .refine((body) => !body.regionCode || body.regionCode.startsWith(`${body.countryCode}-`), {
    path: ['regionCode'],
    message: 'The region is not in that country.',
  });

export type MyPlaceInput = z.infer<typeof myPlaceSchema>;

export const regionsQuerySchema = z.object({ country: countryCode }).strict();

export type RegionsQuery = z.infer<typeof regionsQuerySchema>;

/** A place from the picker: a country, and one of its regions or none for the whole country. */
export const pickQuerySchema = z
  .object({ country: countryCode, region: regionCode.optional() })
  .strict()
  .refine((query) => !query.region || query.region.startsWith(`${query.country}-`), {
    path: ['region'],
    message: 'The region is not in that country.',
  });

export type PickQuery = z.infer<typeof pickQuerySchema>;

/** The seen route: some of the workspace's competitors, or all of them when absent. */
export const seenSchema = z
  .object({ ids: z.array(z.string().uuid()).min(1).max(20).optional() })
  .strict();

export type SeenInput = z.infer<typeof seenSchema>;
