import type { ExportedSlideView, StudioExportEvent } from '@/types/studio';
import {
  DOWNLOAD_NOTE,
  doneLine,
  type ExportState,
  exportReducer,
  formatDetail,
  initialExportState,
  isImageFormat,
  isRunning,
  LOST_DRAFT_MESSAGE,
  LOST_EXPORT_MESSAGE,
  LOST_SEND_MESSAGE,
  pdfFileName,
  progressFraction,
  progressLabel,
  type RunMode,
  runNote,
  SENT_MESSAGE,
  savedLine,
  scaleChoices,
  scaledSizeLabel,
  scaleOf,
  slideSlots,
  UNSAVED_MESSAGE,
  warningLead,
  warningLines,
  zipFileName,
} from './export-model';

function media(index: number): ExportedSlideView {
  const number = String(index + 1).padStart(2, '0');
  return {
    id: `m${index + 1}`,
    name: `Spring Sale ${number}.jpg`,
    url: `https://cdn.example/spring-sale-${number}.jpg`,
    thumbnailUrl: `https://cdn.example/spring-sale-${number}-thumb.jpg`,
  };
}

const start = (slides: number): StudioExportEvent => ({
  type: 'start',
  slides,
  format: 'portrait',
  width: 1080,
  height: 1350,
  imageFormat: 'jpeg',
  scale: 1,
});

const slide = (index: number, total: number): StudioExportEvent => ({
  type: 'slide',
  index,
  total,
  label: `Rendering slide ${index + 1} of ${total}`,
});

const saved = (index: number, total: number): StudioExportEvent => ({
  type: 'saved',
  index,
  total,
  media: media(index),
});

/** Feeds events in order, the way the stream delivers them. */
function feed(state: ExportState, ...events: StudioExportEvent[]): ExportState {
  return events.reduce((next, event) => exportReducer(next, { type: 'event', event }), state);
}

/** Saved what was on screen, and asked: waiting for the stream's first event. */
function asked(mode: RunMode = 'export'): ExportState {
  const begun = exportReducer(initialExportState(mode), { type: 'begin' });
  return exportReducer(begun, { type: 'request' });
}

describe('exportReducer', () => {
  it('starts idle on JPEG, and keeps a format choice until a run starts', () => {
    const idle = initialExportState('export');
    expect(idle.phase).toBe('idle');
    expect(idle.imageFormat).toBe('jpeg');
    expect(isRunning(idle)).toBe(false);
    expect(progressFraction(idle)).toBe(0);
    expect(slideSlots(idle)).toEqual([]);

    const png = exportReducer(idle, { type: 'choose', imageFormat: 'png' });
    expect(png.imageFormat).toBe('png');

    const saving = exportReducer(png, { type: 'begin' });
    expect(saving.phase).toBe('saving');
    expect(saving.imageFormat).toBe('png');
    expect(exportReducer(saving, { type: 'choose', imageFormat: 'jpeg' })).toBe(saving);
  });

  it('saves what is on screen first, and starts nothing when that fails', () => {
    const saving = exportReducer(initialExportState('export'), { type: 'begin' });
    expect(isRunning(saving)).toBe(true);
    expect(progressLabel(saving)).toBe('Saving your latest changes');

    const unsaved = exportReducer(saving, { type: 'unsaved' });
    expect(unsaved.phase).toBe('failed');
    expect(unsaved.failure).toEqual({
      kind: 'unsaved',
      message: UNSAVED_MESSAGE,
      code: null,
      slideIndex: null,
      savedCount: 0,
      retryable: true,
    });
    expect(savedLine(unsaved)).toBeNull();
    expect(isRunning(unsaved)).toBe(false);

    // The request never goes out, and nothing the stream could say applies.
    expect(exportReducer(unsaved, { type: 'request' })).toBe(unsaved);
    expect(feed(unsaved, start(3))).toBe(unsaved);
  });

  it('follows an export event by event to the end', () => {
    let state = asked();
    expect(state.phase).toBe('preparing');
    expect(progressLabel(state)).toBe('Getting ready');

    state = feed(state, start(3));
    expect(state.phase).toBe('rendering');
    expect(state.total).toBe(3);
    expect(formatDetail(state)).toBe('1080 x 1350, JPEG');
    expect(slideSlots(state).map((slot) => slot.status)).toEqual(['waiting', 'waiting', 'waiting']);

    state = feed(state, {
      type: 'warning',
      kind: 'overflow',
      slideIndex: 1,
      message: 'Slide 2: the headline is too long for its space.',
    });
    expect(state.warnings).toEqual([
      { slideIndex: 1, message: 'Slide 2: the headline is too long for its space.' },
    ]);

    state = feed(state, slide(0, 3));
    expect(progressLabel(state)).toBe('Rendering slide 1 of 3');
    expect(progressFraction(state)).toBe(0);
    expect(slideSlots(state)[0]?.status).toBe('rendering');

    state = feed(state, saved(0, 3));
    expect(progressFraction(state)).toBeCloseTo(1 / 3);
    expect(slideSlots(state)[0]).toEqual({ index: 0, status: 'saved', media: media(0) });
    // Until the next slide says so itself, the label already points at it.
    expect(progressLabel(state)).toBe('Rendering slide 2 of 3');

    state = feed(state, slide(1, 3));
    expect(progressLabel(state)).toBe('Rendering slide 2 of 3');
    expect(slideSlots(state).map((slot) => slot.status)).toEqual(['saved', 'rendering', 'waiting']);

    state = feed(state, saved(1, 3), slide(2, 3), saved(2, 3));
    expect(progressFraction(state)).toBe(1);
    expect(progressLabel(state)).toBe('Finishing up');
    expect(isRunning(state)).toBe(true);

    state = feed(state, {
      type: 'done',
      mediaIds: ['m1', 'm2', 'm3'],
      status: 'EXPORTED',
      revision: 12,
      reused: false,
    });
    expect(state.phase).toBe('done');
    expect(isRunning(state)).toBe(false);
    expect(state.result).toEqual({
      mediaIds: ['m1', 'm2', 'm3'],
      status: 'EXPORTED',
      revision: 12,
      reused: false,
    });
    expect(progressLabel(state)).toBe('Saved 3 images to your media library.');
    expect(state.saved.map((entry) => entry.media.id)).toEqual(['m1', 'm2', 'm3']);
    expect(slideSlots(state).every((slot) => slot.status === 'saved')).toBe(true);
    expect(warningLead(state)).toBe(
      'Some slides still need fixing. The images were saved as they are.',
    );

    // A late event belongs to a stream nobody is following.
    expect(feed(state, saved(2, 3))).toBe(state);
    expect(exportReducer(state, { type: 'lost' })).toBe(state);
  });

  it('keeps the slides saved before a failure part way, and marks where it stopped', () => {
    const state = feed(asked(), start(7), slide(0, 7), saved(0, 7), slide(1, 7), saved(1, 7), {
      type: 'slide',
      index: 2,
      total: 7,
      label: 'Rendering slide 3 of 7',
    });

    const failed = feed(state, {
      type: 'error',
      code: 'render_failed',
      message: 'Slide 3 could not be rendered. It took too long to draw.',
      slideIndex: 2,
      savedMediaIds: ['m1', 'm2'],
    });

    expect(failed.phase).toBe('failed');
    expect(failed.failure).toEqual({
      kind: 'stream',
      message: 'Slide 3 could not be rendered. It took too long to draw.',
      code: 'render_failed',
      slideIndex: 2,
      savedCount: 2,
      retryable: true,
    });
    expect(savedLine(failed)).toBe('2 of 7 slides were saved to your media library.');
    expect(failed.saved.map((entry) => entry.media.id)).toEqual(['m1', 'm2']);
    expect(slideSlots(failed).map((slot) => slot.status)).toEqual([
      'saved',
      'saved',
      'failed',
      'missed',
      'missed',
      'missed',
      'missed',
    ]);

    // Try Again starts clean, on the same format.
    const again = exportReducer(failed, { type: 'begin' });
    expect(again.phase).toBe('saving');
    expect(again.saved).toEqual([]);
    expect(again.failure).toBeNull();
    expect(again.total).toBeNull();
  });

  it('sends with the images of an export that is still current', () => {
    let state = asked('send');

    state = feed(state, {
      type: 'done',
      mediaIds: ['m1', 'm2', 'm3'],
      status: 'EXPORTED',
      revision: 4,
      reused: true,
    });
    expect(state.phase).toBe('creating');
    expect(isRunning(state)).toBe(true);
    expect(state.result?.reused).toBe(true);
    expect(progressLabel(state)).toBe('Creating your draft');
    expect(progressFraction(state)).toBe(1);
    expect(runNote(state)).toBe('Using the images from your last export.');
    // Nothing was drawn, so there is no strip of slides.
    expect(slideSlots(state)).toEqual([]);

    state = feed(state, { type: 'sent', group: 'group-1', mediaIds: ['m1', 'm2', 'm3'] });
    expect(state.phase).toBe('sent');
    expect(state.group).toBe('group-1');
    expect(isRunning(state)).toBe(false);
    expect(progressLabel(state)).toBe(SENT_MESSAGE);
  });

  it('sends after a fresh export, and keeps the images when the draft fails', () => {
    let state = feed(asked('send'), start(2), slide(0, 2), saved(0, 2), slide(1, 2), saved(1, 2));
    expect(runNote(state)).toBe(
      'Closing this stops it before the draft is made. Slides already saved stay in your media library.',
    );

    state = feed(state, {
      type: 'done',
      mediaIds: ['m1', 'm2'],
      status: 'EXPORTED',
      revision: 9,
      reused: false,
    });
    expect(state.phase).toBe('creating');
    expect(runNote(state)).toBeNull();

    state = feed(state, {
      type: 'error',
      code: 'send_failed',
      message: 'The export stopped unexpectedly. Please try again.',
      slideIndex: null,
      savedMediaIds: ['m1', 'm2'],
    });
    expect(state.phase).toBe('failed');
    expect(state.failure?.code).toBe('send_failed');
    expect(state.failure?.slideIndex).toBeNull();
    expect(savedLine(state)).toBe('All 2 images are in your media library.');
    expect(slideSlots(state).map((slot) => slot.status)).toEqual(['saved', 'saved']);
  });

  it('never treats a sent event as the end of a plain export', () => {
    const exporting = feed(asked('export'), start(1), slide(0, 1));
    expect(feed(exporting, { type: 'sent', group: 'group-1', mediaIds: [] })).toBe(exporting);
  });

  it('shows a refusal as the API worded it, and knows when trying again cannot help', () => {
    const unavailable = exportReducer(asked(), {
      type: 'refused',
      message: 'Export is not available right now. Please try again later.',
      status: 503,
      code: 'export_unavailable',
    });
    expect(unavailable.phase).toBe('failed');
    expect(unavailable.failure).toMatchObject({
      kind: 'refused',
      message: 'Export is not available right now. Please try again later.',
      code: 'export_unavailable',
      retryable: true,
    });
    expect(savedLine(unavailable)).toBeNull();

    const unreadable = exportReducer(asked(), {
      type: 'refused',
      message: 'This design could not be opened because part of it was not recognised.',
      status: 422,
      code: 'design_unreadable',
    });
    expect(unreadable.failure?.retryable).toBe(false);

    const gone = exportReducer(asked(), {
      type: 'refused',
      message: 'That design could not be found.',
      status: 404,
    });
    expect(gone.failure).toMatchObject({ code: null, retryable: false });
  });

  it('reports a lost connection with what was saved and the slide it was on', () => {
    const exporting = feed(asked(), start(4), slide(0, 4), saved(0, 4), slide(1, 4));
    const lost = exportReducer(exporting, { type: 'lost' });

    expect(lost.failure).toMatchObject({
      kind: 'connection',
      message: LOST_EXPORT_MESSAGE,
      slideIndex: 1,
      savedCount: 1,
      retryable: true,
    });
    expect(savedLine(lost)).toBe('1 of 4 slides was saved to your media library.');
    expect(slideSlots(lost).map((slot) => slot.status)).toEqual([
      'saved',
      'failed',
      'missed',
      'missed',
    ]);

    const beforeAnything = exportReducer(asked('send'), { type: 'lost' });
    expect(beforeAnything.failure?.message).toBe(LOST_SEND_MESSAGE);
    expect(savedLine(beforeAnything)).toBe('No slides were saved.');

    const drafting = feed(asked('send'), {
      type: 'done',
      mediaIds: ['m1'],
      status: 'SENT',
      revision: 2,
      reused: true,
    });
    const lostDraft = exportReducer(drafting, { type: 'lost' });
    expect(lostDraft.failure?.message).toBe(LOST_DRAFT_MESSAGE);
    expect(savedLine(lostDraft)).toBe('The image is in your media library.');
  });

  it('lists each warning once, in slide order', () => {
    const state = feed(
      asked(),
      start(3),
      {
        type: 'warning',
        kind: 'overflow',
        slideIndex: 2,
        message: 'Slide 3: the body is too long.',
      },
      {
        type: 'warning',
        kind: 'emptyPicture',
        slideIndex: 0,
        message: 'Slide 1: the image is empty.',
      },
      {
        type: 'warning',
        kind: 'overflow',
        slideIndex: 2,
        message: 'Slide 3: the body is too long.',
      },
    );

    expect(state.warnings).toEqual([
      { slideIndex: 0, message: 'Slide 1: the image is empty.' },
      { slideIndex: 2, message: 'Slide 3: the body is too long.' },
    ]);
  });

  it('keeps saved slides in slide order whatever order they arrive in', () => {
    const state = feed(asked(), start(3), saved(2, 3), saved(0, 3));

    expect(state.saved.map((entry) => entry.index)).toEqual([0, 2]);
    expect(slideSlots(state).map((slot) => slot.status)).toEqual(['saved', 'waiting', 'saved']);
  });

  it('ignores the stream while nothing is running', () => {
    const idle = initialExportState('export');

    expect(feed(idle, start(3))).toBe(idle);
    expect(exportReducer(idle, { type: 'lost' })).toBe(idle);
    expect(exportReducer(idle, { type: 'refused', message: 'No.', status: 409 })).toBe(idle);
  });
});

describe('warningLines', () => {
  it("merges the editor's issues with the stream's warnings, once each, in slide order", () => {
    const issues = new Map<string, readonly string[]>([
      ['s3', ['Slide 3: the headline is too long for its space.']],
      ['s1', ['Slide 1: the picture is empty.', 'Slide 1: text may be hard to read on the photo.']],
    ]);

    expect(
      warningLines(issues, [
        { slideIndex: 2, message: 'Slide 3: the headline is too long for its space.' },
        { slideIndex: 1, message: 'Slide 2: the logo was deleted.' },
      ]),
    ).toEqual([
      'Slide 1: the picture is empty.',
      'Slide 1: text may be hard to read on the photo.',
      'Slide 2: the logo was deleted.',
      'Slide 3: the headline is too long for its space.',
    ]);
  });

  it('is empty when there is nothing to fix', () => {
    expect(warningLines(new Map(), [])).toEqual([]);
  });
});

describe('copy', () => {
  it('counts images in the done line', () => {
    expect(doneLine(1)).toBe('Saved 1 image to your media library.');
    expect(doneLine(7)).toBe('Saved 7 images to your media library.');
  });

  it('says a run can go ahead despite what needs fixing', () => {
    expect(warningLead(initialExportState('export'))).toBe(
      'Some slides still need fixing. You can still export them as they are.',
    );
    expect(warningLead(initialExportState('send'))).toBe(
      'Some slides still need fixing. You can still send them as they are.',
    );
  });

  it('knows the two image formats', () => {
    expect(isImageFormat('jpeg')).toBe(true);
    expect(isImageFormat('png')).toBe(true);
    expect(isImageFormat('webp')).toBe(false);
  });
});

describe('zipFileName', () => {
  it("names the zip after the design's title, made safe for any file system", () => {
    expect(zipFileName('Spring Sale')).toBe('Spring Sale.zip');
    expect(zipFileName('Q3: Plans/Ideas?')).toBe('Q3 Plans Ideas.zip');
    expect(zipFileName('Launch.')).toBe('Launch.zip');
  });

  it('falls back to Design when nothing usable is left', () => {
    expect(zipFileName('')).toBe('Design.zip');
    expect(zipFileName(' ?* ')).toBe('Design.zip');
  });
});

describe('pdfFileName', () => {
  it('names the PDF as the zip is named', () => {
    expect(pdfFileName('Q3: Plans/Ideas?')).toBe('Q3 Plans Ideas.pdf');
    expect(pdfFileName('')).toBe('Design.pdf');
  });

  it('says the zip carries the caption, and only when there is one', () => {
    expect(DOWNLOAD_NOTE).toBe(
      'Download All also holds the caption as captions.txt, when the design has one.',
    );
  });
});

describe('image scale', () => {
  it('starts at 1x and keeps a 2x choice into the run, but not a change during it', () => {
    const idle = initialExportState('export');
    expect(idle.scale).toBe(1);

    const double = exportReducer(idle, { type: 'scale', scale: 2 });
    expect(double.scale).toBe(2);
    expect(exportReducer(double, { type: 'scale', scale: 2 })).toBe(double);

    const saving = exportReducer(double, { type: 'begin' });
    expect(saving.scale).toBe(2);
    expect(exportReducer(saving, { type: 'scale', scale: 1 })).toBe(saving);
  });

  it('keeps the scale for Try Again after a failed run', () => {
    const begun = exportReducer(
      exportReducer(initialExportState('export'), { type: 'scale', scale: 2 }),
      {
        type: 'begin',
      },
    );
    const failed = exportReducer(begun, { type: 'unsaved' });

    expect(exportReducer(failed, { type: 'begin' }).scale).toBe(2);
  });

  it('reads the radio value as a scale', () => {
    expect(scaleOf('1')).toBe(1);
    expect(scaleOf('2')).toBe(2);
    expect(scaleOf('3')).toBeNull();
  });

  it("shows the pixels each scale makes in the design's format", () => {
    expect(scaledSizeLabel('square', 1)).toBe('1080 x 1080');
    expect(scaledSizeLabel('square', 2)).toBe('2160 x 2160');
    expect(scaledSizeLabel('portrait', 2)).toBe('2160 x 2700');
  });

  it('offers 1x and 2x, with their pixels when the format is known', () => {
    const choices = scaleChoices('portrait');
    expect(choices.map((choice) => choice.title)).toEqual(['1x', '2x']);
    expect(choices[0].hint).toBe('1080 x 1350. The size every platform shows.');
    expect(choices[1].hint).toBe(
      '2160 x 2700. Twice the pixels, for print and sharp screens. The files are bigger.',
    );

    expect(scaleChoices(null)[1].hint).toBe(
      'Twice the pixels, for print and sharp screens. The files are bigger.',
    );
  });

  it('reports the size the stream says, which is already the scaled one', () => {
    const state = feed(asked(), {
      ...start(3),
      width: 2160,
      height: 2700,
      scale: 2,
    } as StudioExportEvent);
    expect(formatDetail(state)).toBe('2160 x 2700, JPEG');
  });
});
