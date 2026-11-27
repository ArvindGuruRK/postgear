/**
 * `POST /clips/emotes/export`'s body: the engine's own request schema
 * (`.strict()`), so the page, the API and the job agree on every field. The
 * bounds that need the video (its length, the light copy's frame) are
 * checked in the service with `checkEmoteBounds`.
 */
import { type EmoteRequest, emoteRequestSchema } from '@postgear/video-engine';

export const emoteExportSchema = emoteRequestSchema;
export type EmoteExportBody = EmoteRequest;
