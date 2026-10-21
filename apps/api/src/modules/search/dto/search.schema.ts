/**
 * The query string of `GET /search` (2026-10-21).
 *
 * `.strict()` like every schema in this API. The text is cleaned (control and
 * invisible characters out, whitespace collapsed, ends trimmed) before its
 * length is judged, so "  launch " and "launch" are the same search and a
 * zero-width space cannot sneak a one-letter search past the minimum.
 */
import { z } from 'zod';
import { collapseWhitespace, stripControlChars } from '../../../common/sanitize';
import { MAX_SEARCH_LENGTH, MIN_SEARCH_LENGTH } from '../../../common/search-terms';

const queryText = z
  .string()
  // Room for padding that the cleanup removes; the real limit is after it.
  .max(MAX_SEARCH_LENGTH * 4)
  .transform((text) => collapseWhitespace(stripControlChars(text)))
  .pipe(z.string().min(MIN_SEARCH_LENGTH).max(MAX_SEARCH_LENGTH));

export const searchQuerySchema = z.object({ q: queryText }).strict();

export type SearchQuery = z.infer<typeof searchQuerySchema>;
