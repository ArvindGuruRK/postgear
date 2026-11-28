import { TooltipProvider } from '@postgear/ui';
import {
  type ClipDocument,
  type CutResult,
  createClipDocument,
  outputDuration,
  removeSourceRange,
  type TranscriptWord,
} from '@postgear/video-engine';
import { IDLE_PREVIEW_SNAPSHOT, type PreviewSnapshot } from '@postgear/video-preview';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { type PlaybackEngine, PlaybackStore } from '../editor/playback';
import { NO_TAKES_LINE, TAKES_KEEP_NOTE } from './transcript-model';
import { TranscriptPane, type TranscriptPaneProps } from './transcript-pane';

jest.mock('@/lib/clips-api', () => ({
  getClipWords: jest.fn(),
  listenToVideo: jest.fn(),
  fixTranscriptWords: jest.fn(async () => ({ changed: 1, fixes: 1 })),
  replaceTranscriptWord: jest.fn(async () => ({ changed: 3, fixes: 3 })),
  cancelClipJob: jest.fn(async () => ({})),
}));
jest.mock('../use-clip-job', () => ({ useClipJob: () => ({ job: null, error: null }) }));
jest.mock('../home/clips-meters', () => ({ AiMinutesChip: () => null }));
// The video's waveform: quiet until 14.5 s, then a game's sound to the end (20 peaks a second).
const mockPeaks = new Uint8Array(1_400);
mockPeaks.fill(4, 0, 290);
mockPeaks.fill(120, 290);
jest.mock('../timeline/timeline-media', () => ({ usePeaks: () => mockPeaks }));
const WAVEFORM = {
  url: 'https://space.test/waveform.bin',
  meta: { perSecond: 20, count: 1_400 },
  expiresAt: '2099-01-01T00:00:00.000Z',
};

const api = jest.requireMock('@/lib/clips-api') as Record<string, jest.Mock>;

/** jsdom has no PointerEvent. */
beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
  if (!('PointerEvent' in window)) {
    class PointerEventStub extends MouseEvent {
      pointerId = 0;
    }
    Object.defineProperty(window, 'PointerEvent', { configurable: true, value: PointerEventStub });
  }
});

const VIDEO = '6f1c2b1e-8d4a-4c1e-9b7a-2f3e4d5c6b7a';
const HEARD_ID = '44444444-4444-4444-8444-444444444444';

function words(spec: Array<[string, number, number]>): TranscriptWord[] {
  return spec.map(([text, start, end], i) => ({ i, start, end, text, sure: 0.9 }));
}

/** Video 10 s to 40 s: "We spent a year." then a 1.7 s pause, "Then um, it worked." */
const SAID = words([
  ['We', 10_200, 10_400],
  ['spent', 10_450, 10_800],
  ['a', 10_850, 10_900],
  ['year.', 10_950, 11_300],
  ['Then', 13_000, 13_300],
  ['um,', 13_400, 13_600],
  ['it', 13_700, 13_800],
  ['worked.', 13_850, 14_200],
]);

function view(list = SAID) {
  return {
    transcript: {
      id: HEARD_ID,
      language: 'en',
      model: 'simulation',
      source: 'listened',
      words: list,
      covered: [{ fromMs: 0, toMs: 70_000 }],
      fixes: 0,
      fileName: null,
    },
    ranges: [{ fromMs: 10_000, toMs: 40_000 }],
    missing: false,
    price: 0,
  };
}

/** A playback engine that only holds a playhead. */
function fakeEngine() {
  let snapshot: PreviewSnapshot = { ...IDLE_PREVIEW_SNAPSHOT, ready: true, durationMs: 30_000 };
  const listeners = new Set<() => void>();
  const engine = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    exactMs: 0,
    play: jest.fn(),
    pause: jest.fn(),
    toggle: jest.fn(),
    seek: jest.fn((ms: number) => {
      snapshot = { ...snapshot, currentMs: ms };
      for (const listener of listeners) listener();
    }),
    stepFrames: jest.fn(),
    setScrubbing: jest.fn(),
  };
  return engine;
}

function setup(overrides: Partial<TranscriptPaneProps> = {}, doc?: ClipDocument) {
  const document =
    doc ?? createClipDocument({ videoId: VIDEO, fromMs: 10_000, toMs: 40_000, ratio: '9:16' });
  const engine = fakeEngine();
  const playback = new PlaybackStore(engine as unknown as PlaybackEngine);
  const applied: Array<{ result: CutResult; sentence: string | null }> = [];
  const onApply = jest.fn<boolean, Parameters<TranscriptPaneProps['onApply']>>((make, describe) => {
    const result = make(document);
    applied.push({ result, sentence: result.ok ? describe(document, result.doc) : null });
    return result.ok;
  });
  const props: TranscriptPaneProps = {
    orgId: 'org-1',
    clipId: 'clip-1',
    videoId: VIDEO,
    videoDurationMs: 600_000,
    document,
    playback,
    captionsTrack: null,
    waveform: WAVEFORM,
    aiOn: true,
    onApply,
    onEditCaptions: jest.fn(),
    onNotice: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };
  render(
    <TooltipProvider>
      <TranscriptPane {...props} />
    </TooltipProvider>,
  );
  const word = (i: number) =>
    screen.getByTestId('transcript-text').querySelector(`[data-word-id="${i}"]`) as HTMLElement;
  return { props, engine, applied, onApply, word, document };
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockClear();
  api.getClipWords?.mockResolvedValue(view());
});

describe('TranscriptPane', () => {
  it('reads the words as spoken and marks the one under the playhead', async () => {
    const { word, engine } = setup();
    await screen.findByTestId('transcript-text');
    expect(api.getClipWords).toHaveBeenCalledWith(
      'clip-1',
      expect.objectContaining({ source: 'spoken' }),
    );
    act(() => engine.seek(300)); // video 10.3 s: "We"
    expect(word(0)).toHaveAttribute('aria-current', 'true');
    act(() => engine.seek(3_200)); // video 13.2 s: "Then"
    expect(word(4)).toHaveAttribute('aria-current', 'true');
    expect(word(0)).not.toHaveAttribute('aria-current');
  });

  it('jumps the playhead to a clicked word, in the clip time', async () => {
    const { word, engine } = setup();
    await screen.findByTestId('transcript-text');
    fireEvent.click(word(4));
    expect(engine.seek).toHaveBeenLastCalledWith(3_000);
  });

  it('cuts selected words between their neighbours as one change, and says how much shorter', async () => {
    const { word, applied, document } = setup();
    const text = await screen.findByTestId('transcript-text');
    fireEvent.pointerDown(word(5), { button: 0 });
    fireEvent.pointerUp(window);
    fireEvent.keyDown(text, { key: 'Delete' });
    expect(applied).toHaveLength(1);
    const first = applied[0];
    if (!first?.result.ok) throw new Error('The cut was refused');
    // "um," and its air go: the clip loses about 0.3 s, cut between "Then" and "it".
    const parts = first.result.doc.segments.map((s) => [s.sourceIn, s.sourceOut]);
    expect(parts).toEqual([
      [10_000, 13_367],
      [13_667, 40_000],
    ]);
    expect(outputDuration(document) - outputDuration(first.result.doc)).toBe(300);
    expect(first.sentence).toBe('Cut 1 word. The clip is 0.3 seconds shorter.');
  });

  it('refuses a cut that would leave the clip under 3 seconds', async () => {
    const short = createClipDocument({
      videoId: VIDEO,
      fromMs: 10_000,
      toMs: 13_500,
      ratio: '9:16',
    });
    const { word, applied } = setup({}, short);
    const text = await screen.findByTestId('transcript-text');
    fireEvent.keyDown(text, { key: 'Home' });
    fireEvent.pointerDown(word(0), { button: 0 });
    fireEvent.pointerDown(word(3), { button: 0, shiftKey: true });
    fireEvent.keyDown(text, { key: 'Delete' });
    expect(applied[0]?.result).toEqual({ ok: false, code: 'clip_too_short' });
  });

  it('strikes cut words through and restores them on hover', async () => {
    const base = createClipDocument({
      videoId: VIDEO,
      fromMs: 10_000,
      toMs: 40_000,
      ratio: '9:16',
    });
    const cut = removeSourceRange(base, base.segments[0]?.source as string, 13_350, 13_650);
    if (!cut.ok) throw new Error(cut.code);
    const { word, applied } = setup({}, cut.doc);
    await screen.findByTestId('transcript-text');
    expect(word(5)).toHaveAttribute('data-state', 'removed');
    fireEvent.mouseEnter(word(5));
    fireEvent.click(screen.getByTestId('transcript-restore'));
    const healed = applied[0]?.result;
    expect(healed?.ok && healed.doc.segments.map((s) => [s.sourceIn, s.sourceOut])).toEqual([
      [10_000, 40_000],
    ]);
  });

  it('offers Listen To This Clip with its price when nothing was heard yet', async () => {
    api.getClipWords?.mockResolvedValue({ transcript: null, ranges: [], missing: false, price: 2 });
    api.listenToVideo?.mockResolvedValue({ covered: true, language: 'en', price: 0 });
    setup();
    const button = await screen.findByTestId('clip-transcript-listen-button');
    expect(button).toHaveTextContent('Listen To This Clip (2 AI Minutes)');
    fireEvent.click(button);
    await waitFor(() =>
      expect(api.listenToVideo).toHaveBeenCalledWith(VIDEO, { fromMs: 0, toMs: 70_000 }),
    );
    // Covered already: the words are read again.
    await waitFor(() => expect(api.getClipWords).toHaveBeenCalledTimes(2));
  });

  it('reads out what listening is doing while it runs (Module 16)', async () => {
    api.getClipWords?.mockResolvedValue({ transcript: null, ranges: [], missing: false, price: 2 });
    api.listenToVideo?.mockResolvedValue({ covered: false, job: { id: 'job-1' } });
    setup();
    fireEvent.click(await screen.findByTestId('clip-transcript-listen-button'));
    const listening = await screen.findByTestId('clip-transcript-listening');
    expect(within(listening).getByRole('status')).not.toBeEmptyDOMElement();
  });

  it('offers Listen for the rest when the clip was only partly listened to', async () => {
    api.getClipWords?.mockResolvedValue({ ...view(), price: 2 });
    setup();
    await screen.findByTestId('transcript-text');
    expect(screen.getByTestId('clip-transcript-partly')).toHaveTextContent(
      'Part of this clip has not been listened to yet.',
    );
    expect(screen.getByTestId('clip-transcript-listen-button')).toHaveTextContent(
      'Listen To This Clip (2 AI Minutes)',
    );
  });

  it('says no words were heard only when every moment was listened to', async () => {
    api.getClipWords?.mockResolvedValue({ ...view([]), price: 0 });
    setup();
    expect(await screen.findByText('No words were heard in this clip.')).toBeInTheDocument();
    expect(screen.queryByTestId('clip-transcript-listen-button')).toBeNull();
    api.getClipWords?.mockResolvedValue({ ...view([]), price: 2 });
  });

  it('keeps Listen off while the AI layer is down, and says so', async () => {
    api.getClipWords?.mockResolvedValue({ transcript: null, ranges: [], missing: false, price: 2 });
    setup({ aiOn: false });
    expect(await screen.findByText(/Captions are not available right now/)).toBeInTheDocument();
    expect(screen.getByTestId('clip-transcript-listen-button')).toBeDisabled();
  });

  it('fixes a word for the whole video when the clip has no captions of these words', async () => {
    const { word } = setup();
    await screen.findByTestId('transcript-text');
    fireEvent.doubleClick(word(1));
    const form = screen.getByTestId('clip-transcript-word-fix');
    fireEvent.change(within(form).getByLabelText('The word shown'), { target: { value: 'spend' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.fixTranscriptWords).toHaveBeenCalledWith(VIDEO, [{ index: 1, text: 'spend' }]),
    );
  });

  it('fixes a word as a caption change when the captions show these words', async () => {
    const onEditCaptions = jest.fn();
    const captionsTrack = {
      id: 'captions',
      kind: 'captions' as const,
      transcriptAssetId: HEARD_ID,
      language: 'en',
      styleId: 'bold-pop',
      position: { x: 0.5, y: 0.8 },
      sizePx: 64,
      maxWords: 3,
      edits: {},
    };
    const { word } = setup({ onEditCaptions, captionsTrack: captionsTrack as never });
    await screen.findByTestId('transcript-text');
    fireEvent.doubleClick(word(1));
    const form = screen.getByTestId('clip-transcript-word-fix');
    fireEvent.change(within(form).getByLabelText('The word shown'), { target: { value: 'spend' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(onEditCaptions).toHaveBeenCalledTimes(1);
    expect(api.fixTranscriptWords).not.toHaveBeenCalled();
  });

  it('Remove Silences says what it found first, and the count follows the slider', async () => {
    const { applied } = setup();
    await screen.findByTestId('transcript-text');
    fireEvent.click(screen.getByTestId('clip-remove-silences'));
    const popover = await screen.findByTestId('clip-silences-popover');
    // The 1.7 s pause less 150 ms of air each side: 1.4 s. After the last word the game is
    // loud, so that stretch is not a pause.
    expect(within(popover).getByTestId('clip-silences-found')).toHaveTextContent(
      '1 pause, 1.4 seconds',
    );
    // The stretch after the last word has the game's sound under it: said, and kept.
    expect(within(popover).getByTestId('clip-silences-loud')).toHaveTextContent(
      'One pause has sound under it (music or a game), so it stays.',
    );
    const thumb = within(popover).getByRole('slider');
    for (let k = 0; k < 10; k += 1) fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(within(popover).getByTestId('clip-silences-found')).toHaveTextContent(
      'No pauses longer than 1.8 seconds.',
    );
    for (let k = 0; k < 10; k += 1) fireEvent.keyDown(thumb, { key: 'ArrowLeft' });
    fireEvent.click(within(popover).getByTestId('clip-silences-remove'));
    expect(applied).toHaveLength(1);
    expect(applied[0]?.sentence).toBe('Removed 1 pause. The clip is 1.4 seconds shorter.');
    // Module 10: the same change records the cleanup, with the slider's value.
    const result = applied[0]?.result;
    expect(result?.ok && result.doc.meta?.cleanup).toEqual({ silencesMinMs: 800 });
  });

  it('Remove Filler Words lists each one with a tick, and removes only the ticked', async () => {
    const { applied } = setup();
    await screen.findByTestId('transcript-text');
    fireEvent.click(screen.getByTestId('clip-remove-fillers'));
    const popover = await screen.findByTestId('clip-fillers-popover');
    expect(within(popover).getByTestId('clip-filler-row')).toHaveTextContent('"um"');
    const tick = within(popover).getByRole('checkbox');
    fireEvent.click(tick);
    expect(within(popover).getByTestId('clip-fillers-remove')).toBeDisabled();
    fireEvent.click(tick);
    fireEvent.click(within(popover).getByTestId('clip-fillers-remove'));
    expect(applied[0]?.sentence).toBe('Removed 1 filler word. The clip is 0.3 seconds shorter.');
    const result = applied[0]?.result;
    expect(result?.ok && result.doc.meta?.cleanup).toEqual({ fillers: true });
  });

  it('Remove Bad Takes lists the earlier try with a tick, and keeps the last try', async () => {
    const stumble = words([
      ['So', 10_200, 10_400],
      ['today', 10_450, 10_800],
      ['we', 10_850, 11_000],
      ['So', 11_600, 11_800],
      ['today', 11_850, 12_100],
      ['we', 12_150, 12_300],
      ['build', 12_350, 12_700],
      ['it.', 12_750, 13_100],
    ]);
    api.getClipWords?.mockResolvedValue(view(stumble));
    const { applied } = setup();
    await screen.findByTestId('transcript-text');
    fireEvent.click(screen.getByTestId('clip-remove-takes'));
    const popover = await screen.findByTestId('clip-takes-popover');
    expect(within(popover).getByTestId('clip-take-row')).toHaveTextContent('"So today we"');
    expect(within(popover).getByText(TAKES_KEEP_NOTE)).toBeInTheDocument();
    const tick = within(popover).getByRole('checkbox');
    fireEvent.click(tick);
    expect(within(popover).getByTestId('clip-takes-remove')).toBeDisabled();
    fireEvent.click(tick);
    expect(within(popover).getByRole('status')).toHaveTextContent('1 take,');
    fireEvent.click(within(popover).getByTestId('clip-takes-remove'));
    expect(applied[0]?.sentence).toMatch(
      /^Removed 1 bad take\. The clip is [0-9.]+ seconds? shorter\.$/,
    );
    const result = applied[0]?.result;
    expect(result?.ok).toBe(true);
    // Not recorded for recipes: a take is a judgement on this clip's own words.
    expect(result?.ok && result.doc.meta?.cleanup).toBeUndefined();
  });

  it('says so when no bad take was found', async () => {
    setup();
    await screen.findByTestId('transcript-text');
    fireEvent.click(screen.getByTestId('clip-remove-takes'));
    expect(await screen.findByText(NO_TAKES_LINE)).toBeInTheDocument();
  });

  it('says so when no filler word was found', async () => {
    api.getClipWords?.mockResolvedValue(view(SAID.filter((word) => word.text !== 'um,')));
    setup();
    await screen.findByTestId('transcript-text');
    fireEvent.click(screen.getByTestId('clip-remove-fillers'));
    expect(await screen.findByText('No filler words found.')).toBeInTheDocument();
  });
});
