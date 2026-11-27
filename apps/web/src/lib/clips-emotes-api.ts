/**
 * Emote Maker calls (Sprint 13, Module 14). Kept beside `clips-api.ts` rather
 * than inside it so the two routes and their types travel together.
 *
 * - `exportEmote`: one press, one job, one download counted. 200 with the
 *   files when it finished within 25 seconds, 202 with the job otherwise;
 *   422 `emote_too_long` or `emote_range_invalid` before any charge; the
 *   typed 402 past the day's downloads.
 * - `getEmote`: the job and, once done, its files with fresh addresses.
 */
import type { EmoteExportBody, EmoteExportOutcome, EmoteView } from '@/types/clips-emotes';
import { api } from './api';

export function exportEmote(body: EmoteExportBody): Promise<EmoteExportOutcome> {
  return api<EmoteExportOutcome>('/clips/emotes/export', { method: 'POST', body });
}

export function getEmote(
  jobId: string,
  options: { signal?: AbortSignal } = {},
): Promise<EmoteView> {
  return api<EmoteView>(`/clips/emotes/${encodeURIComponent(jobId)}`, { signal: options.signal });
}

/**
 * Download All or one file: asks for fresh five minute addresses first (the
 * ones in the card may have run out), then sends the browser to the file,
 * which it saves under the file's own name. False when the file has no
 * address any more (the 24 hours are over); a refusal throws `ApiError`.
 */
export async function saveEmoteFile(jobId: string, name: string): Promise<boolean> {
  const view = await getEmote(jobId);
  const emote = view.emote;
  const url =
    emote?.zip.name === name
      ? emote.zip.url
      : (emote?.files.find((file) => file.name === name)?.url ?? null);
  if (!url) return false;
  window.location.assign(url);
  return true;
}
