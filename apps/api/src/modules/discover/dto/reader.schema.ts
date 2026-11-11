/**
 * The bodies of the reader's two routes (Module 08): one address each.
 *
 * `.strict()` like every schema in this API. The schema only holds the address
 * to being short, single-line text with no space in it. Whether it is an
 * address at all, and where it leads, is for the service: it makes it a real
 * address and runs the private-network guard on it before anything is fetched
 * (`reader.service.ts`).
 */
import { z } from 'zod';
import { stripControlChars } from '../../../common/sanitize';

const ADDRESS_MAX = 2_048;

/** An address as a person pastes it, with or without `https://`. */
const address = z
  .string()
  .max(ADDRESS_MAX * 2)
  .transform((text) => stripControlChars(text).trim())
  .pipe(z.string().min(1).max(ADDRESS_MAX).regex(/^\S+$/));

export const readSchema = z.object({ url: address }).strict();

export type ReadInput = z.infer<typeof readSchema>;

export const resolveLinkSchema = z.object({ url: address }).strict();

export type ResolveLinkInput = z.infer<typeof resolveLinkSchema>;
