/**
 * The bodies of the Saved Ideas routes (Sprint 11 Module 10, backlog #3).
 *
 * A saved idea is a copy of a card as the page showed it, so the workspace can
 * come back to it after the feed has moved on. The copy comes from the
 * browser, so every field is held to the shape Discover itself produces: plain
 * text cut to the lengths a card shows, http(s) addresses only, and nothing a
 * card does not have. Text is cleaned of markup before it is stored, because
 * it is shown to every member and handed to the AI by Create Post.
 */
import { z } from 'zod';
import { sanitizeText } from '../../../common/sanitize';

/** How many ideas one workspace may keep. */
export const MAX_IDEAS = 200;
export const IDEA_NOTE_MAX = 280;

const ITEM_KINDS = ['trend', 'news', 'wiki', 'social', 'video', 'festival', 'competitor'] as const;
const SOURCE_IDS = [
  'google-trends',
  'google-news',
  'wikipedia',
  'youtube',
  'bluesky',
  'mastodon',
  'holidays',
  'rss',
  'gdelt',
  'instagram',
  'serpapi',
  'newsdata',
] as const;

function text(max: number) {
  return z
    .string()
    .max(max * 4)
    .transform(sanitizeText)
    .pipe(z.string().max(max));
}

/** An http(s) address, or the field is refused. Kept as typed (the URL parser normalises it). */
const address = z
  .string()
  .max(2_048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  });

const isoDate = z
  .string()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)));

const itemSchema = z
  .object({
    id: z
      .string()
      .min(4)
      .max(80)
      .regex(/^[A-Za-z0-9:_-]+$/),
    kind: z.enum(ITEM_KINDS),
    source: z
      .object({ id: z.enum(SOURCE_IDS), name: text(80).pipe(z.string().min(1)), url: address.optional() })
      .strict(),
    title: text(300).pipe(z.string().min(1)),
    summary: text(600).optional(),
    url: address.optional(),
    opaqueUrl: address.optional(),
    image: address.optional(),
    publishedAt: isoDate.optional(),
    language: z
      .string()
      .max(35)
      .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/)
      .optional(),
    signal: z
      .object({
        label: text(60),
        rank: z.number().int().min(0).max(10_000).optional(),
        traffic: z.number().int().min(0).max(1e12).optional(),
        views: z.number().int().min(0).max(1e13).optional(),
        posts: z.number().int().min(0).max(1e12).optional(),
      })
      .strict()
      .optional(),
    related: z
      .array(
        z
          .object({ title: text(300).pipe(z.string().min(1)), url: address, source: text(80) })
          .strict(),
      )
      .max(5)
      .optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    observance: z.boolean().optional(),
    brief: text(2_000),
  })
  .strict();

const placeSchema = z
  .object({
    label: text(120).pipe(z.string().min(1)),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
  })
  .strict();

export const saveIdeaSchema = z
  .object({
    item: itemSchema,
    place: placeSchema,
    language: z
      .string()
      .max(35)
      .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/),
    note: text(IDEA_NOTE_MAX).optional(),
  })
  .strict();

export type SaveIdeaInput = z.infer<typeof saveIdeaSchema>;
export type SavedItem = z.infer<typeof itemSchema>;
export type SavedPlace = z.infer<typeof placeSchema>;

/** Null clears the note. */
export const updateIdeaSchema = z.object({ note: text(IDEA_NOTE_MAX).nullable() }).strict();

export type UpdateIdeaInput = z.infer<typeof updateIdeaSchema>;
