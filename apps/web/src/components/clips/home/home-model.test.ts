import { FIXTURE_CARDS, fixtureStatus } from '../clips-fixtures';
import {
  AI_MINUTES_HELP,
  aiMinutesChipView,
  CLIPS_NOT_IN_PLAN_SENTENCE,
  clipsInPlan,
  deleteVideoSentence,
  etaLabel,
  formatSize,
  keptUntilLine,
  keptUntilView,
  linkPlaceholder,
  PLATFORM_LABELS,
  siteHelpLine,
  platformList,
  preflightClipUpload,
  preflightLength,
  refusalExtras,
  stageLabel,
  storageBreakdown,
  storageMeterView,
  storageOverSentence,
  UPLOAD_NOT_VIDEO,
  uploadTypeOf,
  videoMetaLine,
} from './home-model';

const GB = 1_000_000_000;
const CYCLE_END = '2026-12-01T00:00:00.000Z';

function storageAt(used: number, limit: number | null) {
  return fixtureStatus({
    storage: { usedBytes: used, limitBytes: limit },
    usage: { storageBytes: used },
  });
}

describe('formatSize', () => {
  it('counts in decimal units', () => {
    expect(formatSize(412_000_000)).toBe('412 MB');
    expect(formatSize(999_400_000)).toBe('999 MB');
    expect(formatSize(GB)).toBe('1 GB');
    expect(formatSize(1_400_000_000)).toBe('1.4 GB');
    expect(formatSize(3_140_000_000)).toBe('3.1 GB');
    expect(formatSize(50 * GB)).toBe('50 GB');
  });

  it('rounds to whole gigabytes from 100 GB', () => {
    expect(formatSize(150_400_000_000)).toBe('150 GB');
    expect(formatSize(1_234 * GB)).toBe('1,234 GB');
  });

  it('never writes a negative or NaN size', () => {
    expect(formatSize(-5)).toBe('0 MB');
    expect(formatSize(Number.NaN)).toBe('0 MB');
    expect(formatSize(Number.POSITIVE_INFINITY)).toBe('0 MB');
  });
});

describe('storageMeterView', () => {
  it('reads the used and resolved limit, with the help and minutes lines', () => {
    const view = storageMeterView(fixtureStatus());
    expect(view.text).toBe('3.4 GB of 20 GB');
    expect(view.percent).toBe(17);
    expect(view.warning).toBe(false);
    expect(view.full).toBe(false);
    expect(view.lines).toEqual(['Import minutes this month: 120 of 900 left.']);
  });

  it('turns to the warning from 80%', () => {
    expect(storageMeterView(storageAt(15.8 * GB, 20 * GB)).warning).toBe(false);
    const at80 = storageMeterView(storageAt(16 * GB, 20 * GB));
    expect(at80.percent).toBe(80);
    expect(at80.warning).toBe(true);
    expect(at80.full).toBe(false);
  });

  it('is full at the limit and caps the bar at 100 past it', () => {
    const full = storageMeterView(storageAt(20 * GB, 20 * GB));
    expect(full).toMatchObject({ percent: 100, warning: true, full: true });
    const over = storageMeterView(storageAt(25 * GB, 20 * GB));
    expect(over).toMatchObject({ percent: 100, full: true, text: '25 GB of 20 GB' });
  });

  it('has no bar without a ceiling', () => {
    const view = storageMeterView(storageAt(12.4 * GB, null));
    expect(view).toMatchObject({
      text: '12.4 GB used',
      percent: null,
      warning: false,
      full: false,
    });
  });

  it('treats a zero limit as full', () => {
    expect(storageMeterView(storageAt(0, 0))).toMatchObject({ percent: 100, full: true });
  });

  it('says unlimited import minutes when the meter has no ceiling', () => {
    const status = fixtureStatus({
      meters: {
        importMinutes: { used: 10, limit: null, remaining: null, cycleEnd: CYCLE_END },
        aiMinutes: null,
      },
    } as never);
    expect(storageMeterView(status).lines[0]).toBe('Unlimited import minutes this month.');
  });
});

describe('aiMinutesChipView', () => {
  const meter = (remaining: number, limit = 300) => ({ limit, remaining, cycleEnd: CYCLE_END });

  it('reads plenty as "N of M AI minutes left"', () => {
    const view = aiMinutesChipView(meter(240));
    expect(view.text).toBe('240 of 300 AI minutes left');
    expect(view.tone).toBe('plenty');
    expect(view.seePlans).toBe(false);
    expect(view.tooltip).toBe(`${AI_MINUTES_HELP} They reset on 1 December.`);
  });

  it('is low under a tenth left, and plenty at exactly a tenth', () => {
    expect(aiMinutesChipView(meter(29)).tone).toBe('low');
    expect(aiMinutesChipView(meter(30)).tone).toBe('plenty');
  });

  it('says none left with the reset date and offers See Plans', () => {
    const view = aiMinutesChipView(meter(0));
    expect(view).toEqual({
      text: 'No AI minutes left',
      tone: 'none',
      tooltip:
        'This workspace has used all its AI minutes for this month. They reset on 1 December.',
      seePlans: true,
    });
  });

  it('never shows more left than the limit, or fewer than none', () => {
    expect(aiMinutesChipView(meter(400)).text).toBe('300 of 300 AI minutes left');
    expect(aiMinutesChipView(meter(-3)).tone).toBe('none');
  });

  it('handles unlimited and unknown', () => {
    expect(aiMinutesChipView({ limit: null, remaining: null, cycleEnd: CYCLE_END }).tone).toBe(
      'unlimited',
    );
    expect(aiMinutesChipView(null).tone).toBe('unknown');
  });

  it('leaves the reset out when the date does not read', () => {
    const view = aiMinutesChipView({ limit: 300, remaining: 0, cycleEnd: 'not a date' });
    expect(view.tooltip).toBe('This workspace has used all its AI minutes for this month.');
  });
});

describe('etaLabel', () => {
  it('is nothing without an estimate', () => {
    expect(etaLabel(null)).toBeNull();
    expect(etaLabel(undefined)).toBeNull();
    expect(etaLabel(Number.NaN)).toBeNull();
    expect(etaLabel(-1)).toBeNull();
  });

  it('says less than a minute under 90 seconds', () => {
    expect(etaLabel(0)).toBe('Less than a minute left');
    expect(etaLabel(89)).toBe('Less than a minute left');
  });

  it('rounds whole minutes up', () => {
    expect(etaLabel(90)).toBe('About 2 minutes left');
    expect(etaLabel(230)).toBe('About 4 minutes left');
    expect(etaLabel(240)).toBe('About 4 minutes left');
    expect(etaLabel(241)).toBe('About 5 minutes left');
  });
});

describe('stageLabel', () => {
  it("uses the API's words, or a default", () => {
    expect(stageLabel({ stageLabel: 'Getting the video' })).toBe('Getting the video');
    expect(stageLabel({ stageLabel: 'Waiting for our turn' })).toBe('Waiting for our turn');
    expect(stageLabel({ stageLabel: '   ' })).toBe('Getting ready');
    expect(stageLabel(null)).toBe('Getting ready');
  });

  it('says how long a queued job waits, when the API can tell (Module 15)', () => {
    const queued = { status: 'QUEUED' as const, stageLabel: 'Waiting for our turn' };
    expect(
      stageLabel({ ...queued, waiting: { aboutSeconds: 240, position: 2, lowPriority: false } }),
    ).toBe('Waiting for our turn, about 4 minutes');
    expect(stageLabel({ ...queued, waiting: null })).toBe('Waiting for our turn');
  });
});

describe('uploadTypeOf', () => {
  it("keeps the file's own type when it is one we take", () => {
    expect(uploadTypeOf({ name: 'clip', type: 'video/webm' })).toBe('video/webm');
    expect(uploadTypeOf({ name: 'clip.mp4', type: 'VIDEO/MP4' })).toBe('video/mp4');
  });

  it('falls back on the extension when the type is empty or unknown', () => {
    expect(uploadTypeOf({ name: 'stream.mkv', type: '' })).toBe('video/x-matroska');
    expect(uploadTypeOf({ name: 'HOLIDAY.MOV', type: 'application/octet-stream' })).toBe(
      'video/quicktime',
    );
    expect(uploadTypeOf({ name: 'old.m4v', type: '' })).toBe('video/x-m4v');
  });

  it('is null for anything else', () => {
    expect(uploadTypeOf({ name: 'notes.txt', type: 'text/plain' })).toBeNull();
    expect(uploadTypeOf({ name: 'film.avi', type: 'video/x-msvideo' })).toBeNull();
    expect(uploadTypeOf({ name: 'no-extension', type: '' })).toBeNull();
  });
});

describe('preflightClipUpload', () => {
  const status = fixtureStatus();

  it("names the file's size and the plan's cap", () => {
    expect(
      preflightClipUpload({ name: 'big.mp4', type: 'video/mp4', size: 3_140_000_000 }, status),
    ).toBe('This file is 3.1 GB. Uploads can be up to 2 GB.');
  });

  it('refuses a file that is not a video, or is empty', () => {
    expect(preflightClipUpload({ name: 'a.pdf', type: 'application/pdf', size: 10 }, status)).toBe(
      UPLOAD_NOT_VIDEO,
    );
    expect(preflightClipUpload({ name: 'a.mp4', type: 'video/mp4', size: 0 }, status)).toBe(
      UPLOAD_NOT_VIDEO,
    );
  });

  it('lets a file within the cap through, and any size when the cap is unknown', () => {
    expect(
      preflightClipUpload({ name: 'a.mp4', type: 'video/mp4', size: 2 * GB }, status),
    ).toBeNull();
    expect(
      preflightClipUpload({ name: 'a.mp4', type: 'video/mp4', size: 9 * GB }, null),
    ).toBeNull();
  });
});

describe('preflightLength', () => {
  it("refuses a video longer than the plan's minutes, and nothing else", () => {
    const status = fixtureStatus();
    expect(preflightLength(241 * 60_000, status)).toContain('240');
    expect(preflightLength(240 * 60_000, status)).toBeNull();
    expect(preflightLength(null, status)).toBeNull();
    expect(preflightLength(999 * 60_000, null)).toBeNull();
  });
});

describe('refusalExtras', () => {
  it('offers See Plans for a plan limit', () => {
    expect(refusalExtras('clips_import_minutes')).toEqual({ seePlans: true, upload: false });
    expect(refusalExtras('channel_limit')).toEqual({ seePlans: true, upload: false });
  });

  it('offers Upload A Video for a link we cannot read', () => {
    expect(refusalExtras('link_unsupported')).toEqual({ seePlans: false, upload: true });
    expect(refusalExtras('platform_resting')).toEqual({ seePlans: false, upload: true });
    expect(refusalExtras('platform_paused')).toEqual({ seePlans: false, upload: true });
  });

  it('offers nothing otherwise', () => {
    expect(refusalExtras('link_private')).toEqual({ seePlans: false, upload: false });
    expect(refusalExtras(undefined)).toEqual({ seePlans: false, upload: false });
  });
});

describe('cards', () => {
  it('writes the meta line with the platform, length and clip count', () => {
    expect(videoMetaLine(FIXTURE_CARDS.ready)).toBe('Twitch, 3 h 42 min, 12 clips');
    expect(videoMetaLine({ ...FIXTURE_CARDS.ready, clipCount: 1 })).toBe(
      'Twitch, 3 h 42 min, 1 clip',
    );
    expect(videoMetaLine(FIXTURE_CARDS.busy)).toBe('YouTube, 3 h 42 min');
    expect(
      videoMetaLine({
        ...FIXTURE_CARDS.ready,
        video: { ...FIXTURE_CARDS.ready.video, platform: 'upload', durationMs: null },
        clipCount: undefined,
      }),
    ).toBe('Upload');
  });

  it('says how long a video is kept', () => {
    expect(keptUntilLine('2026-11-28T10:00:00.000Z')).toBe('Kept until 28 Nov');
    expect(keptUntilLine(null)).toBeNull();
  });

  it('counts the clips that go with a deleted video', () => {
    expect(deleteVideoSentence(0)).toBe('Delete this video? Exported clips stay in Media.');
    expect(deleteVideoSentence(1)).toBe(
      'Delete this video and its 1 clip that was never exported? Exported clips stay in Media.',
    );
    expect(deleteVideoSentence(4)).toBe(
      'Delete this video and its 4 clips that were never exported? Exported clips stay in Media.',
    );
    expect(deleteVideoSentence(Number.NaN)).toBe(
      'Delete this video? Exported clips stay in Media.',
    );
  });
});

describe('the link box words', () => {
  it('lists the platforms switched on in a fixed order', () => {
    expect(platformList(['kick', 'youtube', 'twitch'])).toBe('YouTube, Twitch or Kick');
    expect(platformList(['twitch'])).toBe('Twitch');
    expect(platformList([])).toBe('');
    // Module 12: one placeholder, whatever is on.
    expect(linkPlaceholder(['twitch', 'kick'])).toBe('Enter your video link');
    expect(linkPlaceholder([])).toBe('Enter your video link');
  });

  it('writes the help line: five names and more, the whole list for the tooltip (Module 12)', () => {
    expect(siteHelpLine(['kick', 'youtube', 'twitch'])).toEqual({
      shown: 'YouTube, Twitch and Kick',
      more: false,
      all: 'YouTube, Twitch and Kick',
    });
    expect(siteHelpLine(['twitch'])).toEqual({ shown: 'Twitch', more: false, all: 'Twitch' });
    expect(siteHelpLine([])).toEqual({ shown: '', more: false, all: '' });
    const many = siteHelpLine(['reddit', 'youtube', 'vimeo', 'twitch', 'kick', 'rumble', 'x']);
    expect(many.shown).toBe('YouTube, Twitch, Kick, Vimeo, Rumble');
    expect(many.more).toBe(true);
    expect(many.all).toBe('YouTube, Twitch, Kick, Vimeo, Rumble, X and Reddit');
  });

  it("labels a card's badge with the site's name", () => {
    expect(PLATFORM_LABELS.vimeo).toBe('Vimeo');
    expect(PLATFORM_LABELS.x).toBe('X');
    expect(PLATFORM_LABELS.upload).toBe('Upload');
  });
});

describe('Module 19: keeping, size and the plan', () => {
  const NOW = Date.parse('2026-11-19T12:00:00.000Z');
  const DAY = 86_400_000;

  it('says "Kept until" while far, and "Removed in N days" in the last three days', () => {
    expect(keptUntilView(new Date(NOW + 10 * DAY).toISOString(), NOW)).toEqual({
      text: 'Kept until 29 Nov',
      soon: false,
    });
    expect(keptUntilView(new Date(NOW + 2 * DAY).toISOString(), NOW)).toEqual({
      text: 'Removed in 2 days',
      soon: true,
    });
    expect(keptUntilView(new Date(NOW + 3 * DAY).toISOString(), NOW)).toEqual({
      text: 'Removed in 3 days',
      soon: true,
    });
    expect(keptUntilView(new Date(NOW + 0.5 * DAY).toISOString(), NOW)?.text).toBe(
      'Removed in 1 day',
    );
    expect(keptUntilView(new Date(NOW - DAY).toISOString(), NOW)?.text).toBe('Removed today');
    expect(keptUntilView(null, NOW)).toBeNull();
    expect(keptUntilView('not a date', NOW)).toBeNull();
  });

  it('adds the stored size to the meta line only when asked', () => {
    const card = {
      video: { platform: 'twitch', durationMs: 600_000 },
      job: null,
      clipCount: 2,
      storedBytes: 1_400_000_000,
    } as never;
    expect(videoMetaLine(card)).toBe('Twitch, 10 min, 2 clips');
    expect(videoMetaLine(card, { withSize: true })).toBe('Twitch, 10 min, 2 clips, 1.4 GB');
  });

  it('breaks the space down by kind', () => {
    const status = {
      ...storageAt(0, 3_000_000_000),
      usage: {
        storageBytes: 0,
        byKind: { videos: 3_200_000_000, downloads: 120_000_000, library: 4_000_000 },
      },
    };
    expect(storageBreakdown(status).map((row) => `${row.label}: ${row.text}`)).toEqual([
      'Videos: 3.2 GB',
      'Downloads: 120 MB',
      'Your stickers and sounds: 4 MB',
    ]);
  });

  it('writes the over-the-plan sentence the API refuses with, only when over', () => {
    const over = { ...storageAt(4_200_000_000, 3_000_000_000), overLimit: true };
    expect(storageOverSentence(over)).toBe(
      "Your videos use 4.2 GB, over your plan's 3 GB. Delete some, or upgrade, to bring in more.",
    );
    expect(storageOverSentence({ ...over, overLimit: false })).toBeNull();
  });

  it('reads whether the plan has Clips', () => {
    expect(clipsInPlan(null)).toBe(true);
    expect(clipsInPlan({ limits: { 'clips.enabled': false } } as never)).toBe(false);
    expect(CLIPS_NOT_IN_PLAN_SENTENCE).toBe("Clips is not part of this workspace's plan.");
  });
});
