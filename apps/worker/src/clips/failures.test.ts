import {
  ChannelListerError,
  DiskSpaceError,
  DownloaderError,
  FfmpegError,
  ProbeError,
  RenderError,
  ToolError,
  ToolMissingError,
} from '@postgear/media-tools';
import { CLIP_FAILURE_TYPES, CLIP_NON_RETRYABLE } from '@postgear/scheduling';
import { NON_RETRYABLE_CLIP_CODES, RenderCompileError } from '@postgear/video-engine';
import { ApplicationFailure, CancelledFailure } from '@temporalio/common';
import { ClipStepError, classifyClipError, clipFailure } from './failures';

describe('the two lists of codes that never retry', () => {
  it('match as sets (scheduling hands Temporal what the engine decides)', () => {
    expect(new Set(CLIP_NON_RETRYABLE)).toEqual(new Set(NON_RETRYABLE_CLIP_CODES));
    expect(CLIP_NON_RETRYABLE).toHaveLength(NON_RETRYABLE_CLIP_CODES.length);
  });
});

describe('classifyClipError', () => {
  const table: Array<[string, unknown, { code: string; retryable: boolean }]> = [
    [
      'a step refusal with a final code',
      new ClipStepError('clips_storage_full'),
      { code: 'clips_storage_full', retryable: false },
    ],
    [
      'a step refusal with a passing code',
      new ClipStepError('tool_failed'),
      { code: 'tool_failed', retryable: true },
    ],
    [
      'a step refusal marked permanent',
      new ClipStepError('tool_failed', { retryable: false }),
      { code: 'tool_failed', retryable: false },
    ],
    ['a cancel', new CancelledFailure('cancelled'), { code: 'cancelled', retryable: false }],
    [
      'a document that cannot render',
      new RenderCompileError('layout_unsupported', 'no'),
      { code: 'export_failed', retryable: false },
    ],
    [
      'a missing font',
      new RenderCompileError('font_missing', 'no'),
      { code: 'font_missing', retryable: false },
    ],
    [
      'a private link',
      new DownloaderError('link_private'),
      { code: 'link_private', retryable: false },
    ],
    [
      'a resting platform',
      new DownloaderError('platform_resting'),
      { code: 'platform_resting', retryable: true },
    ],
    [
      'a fetch hiccup',
      new DownloaderError('tool_failed'),
      { code: 'tool_failed', retryable: true },
    ],
    [
      'a gone format',
      new DownloaderError('format_gone'),
      { code: 'format_gone', retryable: false },
    ],
    [
      'a missing channel',
      new ChannelListerError('channel_not_found'),
      { code: 'channel_not_found', retryable: false },
    ],
    [
      'a listing hiccup',
      new ChannelListerError('channel_listing_failed'),
      { code: 'channel_listing_failed', retryable: true },
    ],
    [
      'a file that is not a video',
      new ProbeError('upload_not_video'),
      { code: 'upload_not_video', retryable: false },
    ],
    ['an FFmpeg failure', new FfmpegError('tool_failed'), { code: 'tool_failed', retryable: true }],
    ['a stopped FFmpeg', new FfmpegError('cancelled'), { code: 'cancelled', retryable: false }],
    ['a render failure', new RenderError('tool_failed'), { code: 'tool_failed', retryable: true }],
    ['a full scratch disk', new DiskSpaceError(1, 2), { code: 'clips_busy', retryable: true }],
    [
      'a missing program',
      new ToolMissingError('ffmpeg'),
      { code: 'tools_offline', retryable: true },
    ],
    [
      'a stopped program',
      new ToolError({ tool: 'ffmpeg', exitCode: null, aborted: true }),
      { code: 'cancelled', retryable: false },
    ],
    [
      'a program that exited badly',
      new ToolError({ tool: 'ffmpeg', exitCode: 1 }),
      { code: 'tool_failed', retryable: true },
    ],
    ['anything else', new Error('boom'), { code: 'tool_failed', retryable: true }],
  ];

  it.each(table)('%s', (_name, error, expected) => {
    expect(classifyClipError(error)).toMatchObject(expected);
  });
});

describe('clipFailure', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('carries the code in details and marks final codes non-retryable', () => {
    const failure = clipFailure(new ProbeError('upload_not_video'), {
      activity: 'clipImport',
      jobId: 'j',
    });
    expect(failure.type).toBe(CLIP_FAILURE_TYPES.permanent);
    expect(failure.nonRetryable).toBe(true);
    expect(failure.details).toEqual([{ code: 'upload_not_video' }]);
  });

  it('never puts a tool text in the message', () => {
    const tool = new ToolError({ tool: 'ffmpeg', exitCode: 1, stderrTail: 'secret /path/to/file' });
    const failure = clipFailure(tool, { activity: 'clipRender' });
    expect(failure.type).toBe(CLIP_FAILURE_TYPES.retryable);
    expect(failure.message).not.toContain('secret');
    expect(JSON.stringify(failure.details)).not.toContain('secret');
  });

  it('passes an ApplicationFailure through untouched', () => {
    const original = ApplicationFailure.create({ message: 'x', type: 'Other' });
    expect(clipFailure(original, { activity: 'a' })).toBe(original);
  });
});
