import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  type APIRequestContext,
  expect,
  type Locator,
  type Page,
  type Response,
} from '@playwright/test';
import { API_URL, getJson, prisma } from './clips';

/**
 * Helpers for the Sprint 13 Clips AI suite (`e2e/clips-ai.spec.ts`). The
 * Sprint 12 suite keeps its own copies of the editor helpers (it must stay
 * unchanged), so the few this suite shares are written again here.
 */

function apiPath(response: Response): string {
  return new URL(response.url()).pathname;
}

/** The next answer to `method` on an API path matching `path`. */
export function answer(
  target: Page,
  method: string,
  route: string | RegExp,
  timeout = 60_000,
): Promise<Response> {
  return target.waitForResponse(
    (response) =>
      response.request().method() === method &&
      response.url().startsWith(API_URL) &&
      (typeof route === 'string' ? apiPath(response) === route : route.test(apiPath(response))),
    { timeout },
  );
}

export function editorHref(org: string, clipId: string): string {
  return `/${org}/clips/edit/${clipId}`;
}

/** The first-open shape question, found by its heading (the dialog has no name of its own). */
export function shapeDialog(target: Page): Locator {
  return target
    .getByRole('dialog')
    .filter({ has: target.getByRole('heading', { name: 'What Do You Want To Make?' }) });
}

/**
 * Opens a clip in the editor and answers the first-open shape question when
 * it is asked (Vertical: every clip of this suite is made for a phone).
 */
export async function openClipEditor(target: Page, org: string, clipId: string): Promise<void> {
  // The question is asked while `meta.shapeChosen` is not set (read first, so no guessing).
  const asks = (await getClip(target.request, clipId)).document.meta?.shapeChosen !== true;
  await target.goto(editorHref(org, clipId));
  await expect(target.getByTestId('clip-editor')).toBeVisible({ timeout: 60_000 });
  if (asks) {
    const shape = shapeDialog(target);
    await expect(shape).toBeVisible({ timeout: 30_000 });
    await shape.getByRole('button', { name: /^Vertical/ }).click();
    await shape.getByTestId('clip-shape-continue').click();
    await expect(shape).toBeHidden();
    await expectEditorSaved(target);
  }
}

export async function openEditorTab(target: Page, tab: string): Promise<void> {
  const button = target.getByTestId(`clip-tab-${tab}`);
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

/** Waits for the editor's autosave to land (it saves about 1.5 s after the last change). */
export async function expectEditorSaved(target: Page): Promise<void> {
  const status = target.getByTestId('clip-save-status');
  await target.waitForTimeout(300);
  await expect(status).toHaveAttribute('data-status', 'saved', { timeout: 20_000 });
}

/** Opens one card of the Effects tab (an accordion item) when it is closed. */
export async function openEffect(target: Page, value: string, name: RegExp): Promise<Locator> {
  await openEditorTab(target, 'effects');
  const card = target.getByTestId(`clip-effect-${value}`);
  const trigger = card.getByRole('button', { name }).first();
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  return card;
}

/** A toast (or any live line) with exactly this text. */
export function sentence(target: Page, text: string): Locator {
  return target.getByText(text, { exact: true }).first();
}

/* -------------------------------------------------------------------------- */
/* What the API answers                                                       */
/* -------------------------------------------------------------------------- */

export interface Segment {
  id: string;
  sourceIn: number;
  sourceOut: number;
  speed: number;
  role?: string;
}

export interface CaptionsTrackDoc {
  kind: 'captions';
  transcriptAssetId: string;
  styleId: string;
  /** This clip's own word changes, keyed by the word's index. */
  edits: Record<string, { text?: string; hidden?: boolean }>;
}

export interface ClipDocument {
  canvas: { ratio: string };
  layout: { kind: string; follow?: unknown; areas: Array<{ name?: string; crop: unknown[] }> };
  segments: Segment[];
  tracks: Array<{ kind: string; items?: Array<Record<string, unknown>> } & Record<string, unknown>>;
  bleeps?: unknown[];
  recipeId?: string | null;
  meta?: Record<string, unknown>;
}

export interface ClipDetail {
  id: string;
  title: string;
  revision: number;
  videoId: string;
  origin: string;
  document: ClipDocument;
}

export async function getClip(request: APIRequestContext, clipId: string): Promise<ClipDetail> {
  return (await getJson<{ clip: ClipDetail }>(request, `/clips/${clipId}`)).clip;
}

export function captionsOf(doc: ClipDocument): CaptionsTrackDoc | null {
  return (
    (doc.tracks.find((track) => track.kind === 'captions') as unknown as CaptionsTrackDoc) ?? null
  );
}

/** The clip's length on screen, as the editor counts it. */
export function outputMs(doc: ClipDocument): number {
  return doc.segments.reduce(
    (sum, part) => sum + (part.sourceOut - part.sourceIn) / (part.speed || 1),
    0,
  );
}

export async function renameClip(
  request: APIRequestContext,
  clipId: string,
  title: string,
): Promise<void> {
  const clip = await getClip(request, clipId);
  const response = await request.patch(`${API_URL}/clips/${clipId}`, {
    data: { revision: clip.revision, title },
  });
  expect(response.ok(), `PATCH /clips/${clipId}: ${await response.text()}`).toBe(true);
}

export interface ClipRow {
  id: string;
  title: string;
  origin: string;
  range: { fromMs: number; toMs: number } | null;
  reasons: string[];
  videoId: string;
}

export async function clipsOfVideo(
  request: APIRequestContext,
  videoId: string,
): Promise<ClipRow[]> {
  const rows: ClipRow[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const body = await getJson<{ clips: ClipRow[]; total: number }>(
      request,
      `/clips?videoId=${videoId}&page=${page}`,
    );
    rows.push(...body.clips);
    if (rows.length >= body.total || body.clips.length === 0) break;
  }
  return rows;
}

export interface TranscriptWordView {
  i: number;
  text: string;
  start: number;
  end: number;
  sure: number;
}

export interface TranscriptRead {
  transcript: {
    id: string;
    words: TranscriptWordView[];
    covered: Array<{ fromMs: number; toMs: number }>;
  } | null;
}

export function readTranscript(
  request: APIRequestContext,
  videoId: string,
): Promise<TranscriptRead> {
  return getJson<TranscriptRead>(request, `/clips/videos/${videoId}/transcript`);
}

/** The demo workspace's AI minutes used this month, as the meter counts them. */
export async function aiMinutesUsed(request: APIRequestContext): Promise<number> {
  const view = await getJson<{ meters: Record<string, { used: number }> }>(
    request,
    '/entitlements/me',
  );
  const key = Object.keys(view.meters).find((name) => name.includes('ai_minutes'));
  if (!key) throw new Error(`No AI minutes meter in ${Object.keys(view.meters).join(', ')}`);
  return view.meters[key]?.used ?? 0;
}

/** Imports a link through the API (setup, not the thing tested) and returns the new video's id. */
export async function importLink(request: APIRequestContext, url: string): Promise<string> {
  const response = await request.post(`${API_URL}/clips/videos`, {
    data: { url, rightsConfirmed: true },
  });
  const text = await response.text();
  expect(response.status(), `import ${url}: ${text}`).toBe(201);
  return (JSON.parse(text) as { video: { id: string } }).video.id;
}

/* -------------------------------------------------------------------------- */
/* Pictures and files                                                         */
/* -------------------------------------------------------------------------- */

/** A PNG's size from its IHDR chunk (bytes 16 to 23, big-endian). */
export function pngSize(bytes: Buffer): { width: number; height: number } {
  const signature = bytes.subarray(0, 8).toString('hex');
  expect(signature, 'a PNG signature').toBe('89504e470d0a1a0a');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Reads a GIF back with ffprobe (the `FFPROBE_PATH` the worker uses; on this
 * machine a wrapper that runs the worker image's pinned ffprobe). Null when
 * no ffprobe answers, so the caller can say it fell back to the API's numbers.
 */
export function probeGif(file: string): { frames: number; width: number; height: number } | null {
  // The worker's own variable, read from the root .env that `test:e2e` loads.
  const variable = 'FFPROBE_PATH';
  const tool = process.env[variable] || 'ffprobe';
  try {
    const out = execFileSync(
      tool,
      [
        '-v',
        'error',
        '-count_frames',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=nb_read_frames,width,height',
        '-of',
        'json',
        file,
      ],
      { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const stream = (
      JSON.parse(out) as {
        streams?: Array<{ nb_read_frames?: string; width?: number; height?: number }>;
      }
    ).streams?.[0];
    if (!stream) return null;
    return {
      frames: Number(stream.nb_read_frames ?? 0),
      width: stream.width ?? 0,
      height: stream.height ?? 0,
    };
  } catch {
    return null;
  }
}

/** The private Clips folder of one video (local development storage). */
export function videoFolder(org: string, videoId: string): string {
  return path.resolve('apps', 'api', 'uploads-private', 'clips', org, videoId);
}

/** The transcript and face files still in a video's private folder. */
export function speechAndFaceFiles(org: string, videoId: string): string[] {
  const folder = videoFolder(org, videoId);
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter(
    (name) => name.startsWith('transcript-') || name.startsWith('faces-'),
  );
}

/* -------------------------------------------------------------------------- */
/* Plan overrides through the operator API (the resolver's cache is stamped)  */
/* -------------------------------------------------------------------------- */

interface OverrideRow {
  key: string;
  updatedAt: string;
}

async function overridesOf(request: APIRequestContext, org: string): Promise<OverrideRow[]> {
  return (
    await getJson<{ overrides: OverrideRow[] }>(request, `/operator/workspaces/${org}/entitlements`)
  ).overrides;
}

export async function putOverride(
  request: APIRequestContext,
  org: string,
  key: string,
  value: number,
  reason: string,
): Promise<void> {
  const existing = (await overridesOf(request, org)).find((row) => row.key === key);
  const response = await request.put(`${API_URL}/operator/workspaces/${org}/overrides/${key}`, {
    data: {
      value,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      reason,
      updatedAt: existing?.updatedAt ?? null,
    },
  });
  expect(response.ok(), `PUT override ${key}: ${await response.text()}`).toBe(true);
}

/** Removes an override when there is one; returns the HTTP status (0 when there was none). */
export async function removeOverride(
  request: APIRequestContext,
  org: string,
  key: string,
  reason: string,
): Promise<number> {
  const existing = (await overridesOf(request, org)).find((row) => row.key === key);
  if (!existing) return 0;
  const response = await request.delete(`${API_URL}/operator/workspaces/${org}/overrides/${key}`, {
    data: { reason, updatedAt: existing.updatedAt },
  });
  return response.status();
}

/* -------------------------------------------------------------------------- */
/* What this suite makes beyond the Sprint 12 register                       */
/* -------------------------------------------------------------------------- */

export interface AiRun {
  recipes: string[];
  designs: string[];
  designMedia: string[];
  batches: string[];
  /** Channels whose posting times the run changed, with the value to put back. */
  postingTimes: Array<{ id: string; value: string }>;
  overrides: Array<{ org: string; key: string }>;
}

export function newAiRun(): AiRun {
  return {
    recipes: [],
    designs: [],
    designMedia: [],
    batches: [],
    postingTimes: [],
    overrides: [],
  };
}

/** Takes back what `AiRun` lists; returns the steps that answered an error. */
export async function cleanUpAiRun(request: APIRequestContext, run: AiRun): Promise<string[]> {
  const problems: string[] = [];
  const note = (step: string, status: number) => {
    if (status >= 400 && status !== 404) problems.push(`${step} answered HTTP ${status}`);
  };

  for (const id of run.recipes) {
    note(
      `DELETE /clips/recipes/${id}`,
      (await request.delete(`${API_URL}/clips/recipes/${id}`)).status(),
    );
  }
  for (const id of run.designs) {
    const design = await request.get(`${API_URL}/studio/designs/${id}`);
    if (design.ok()) {
      const body = (await design.json()) as { design: { exportedMediaIds: string[] } };
      for (const media of body.design.exportedMediaIds) {
        if (!run.designMedia.includes(media)) run.designMedia.push(media);
      }
    }
  }
  for (const id of run.designMedia) {
    note(`DELETE /media/${id}`, (await request.delete(`${API_URL}/media/${id}`)).status());
  }
  for (const id of run.designs) {
    note(
      `DELETE /studio/designs/${id}`,
      (await request.delete(`${API_URL}/studio/designs/${id}`)).status(),
    );
  }
  if (run.batches.length > 0) {
    await prisma.notifications.deleteMany({
      where: { OR: run.batches.map((id) => ({ meta: { path: ['batchId'], equals: id } })) },
    });
  }
  for (const { id, value } of run.postingTimes) {
    await prisma.integration.update({
      where: { id },
      data: { postingTimes: value },
    });
  }
  return problems;
}
