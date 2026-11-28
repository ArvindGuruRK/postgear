import { TooltipProvider } from '@postgear/ui';
import {
  type ClipDocument,
  countSounds,
  createClipDocument,
  hookTitleOf,
  type TranscriptWord,
} from '@postgear/video-engine';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState, useSyncExternalStore } from 'react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError } from '@/lib/api';
import type { ClipJobView, ClipsAiStatus, ClipWaveform, ClipWordsView } from '@/types/clips';
import { PlaybackStore } from '../editor/playback';
import type { AiEffectsDeps } from './ai-effects-deps';
import { EffectsPanel } from './effects-panel';

jest.mock('@/lib/entitlements', () => ({
  meterOf: () => null,
  useEntitlements: () => ({ snapshot: null, status: 'idle', refresh: async () => undefined }),
}));

const VIDEO = '3f2a9c1e-0000-4000-8000-000000000010';

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

/** 10 s to 40 s of the video, one part. */
function clip(): ClipDocument {
  return {
    ...createClipDocument({ videoId: VIDEO, fromMs: 10_000, toMs: 40_000, ratio: '9:16' }),
    meta: { shapeChosen: true },
  };
}

const word = (i: number, text: string, start: number): TranscriptWord => ({
  i,
  text,
  start,
  end: start + 400,
  sure: 1,
});

const WORDS: TranscriptWord[] = [
  word(1, 'this', 12_000),
  word(2, 'shit,', 12_500),
  word(3, 'is', 13_000),
  word(4, 'darn', 14_000),
  word(5, 'bastards!', 20_000),
];

function wordsView(words: TranscriptWord[] | null, price = 0): ClipWordsView {
  return {
    transcript: words
      ? {
          id: 'tr-1',
          language: 'en',
          model: 'sim',
          source: 'listened',
          words,
          covered: [{ fromMs: 0, toMs: 600_000 }],
          fixes: 0,
          fileName: null,
        }
      : null,
    ranges: [],
    missing: false,
    price,
  };
}

function job(id: string, status: ClipJobView['status'], result: ClipJobView['result'] = null) {
  return {
    id,
    kind: 'SPEECH',
    status,
    stage: 'voice',
    stageLabel: status === 'RUNNING' ? 'Making the voice' : 'Done',
    progress: status === 'RUNNING' ? 40 : 100,
    etaSeconds: null,
    videoId: null,
    clipId: 'clip-1',
    error: null,
    result,
    createdAt: '2026-11-27T00:00:00Z',
    startedAt: null,
    finishedAt: null,
  } as unknown as ClipJobView;
}

/** A job store the fake `useJob` reads, so a test can finish a job. */
const jobs = {
  current: null as ClipJobView | null,
  listeners: new Set<() => void>(),
  set(next: ClipJobView | null) {
    jobs.current = next;
    for (const listener of jobs.listeners) listener();
  },
};
function useFakeJob(jobId: string | null) {
  const current = useSyncExternalStore(
    (listener) => {
      jobs.listeners.add(listener);
      return () => jobs.listeners.delete(listener);
    },
    () => jobs.current,
  );
  return { job: jobId && current?.id === jobId ? current : null };
}

function fakeDeps(
  overrides: Partial<AiEffectsDeps> = {},
): AiEffectsDeps & Record<string, jest.Mock> {
  return {
    spokenWords: jest.fn(async () => wordsView(WORDS)),
    listen: jest.fn(async () => ({
      covered: false,
      job: job('listen-1', 'RUNNING'),
      price: 3,
      joined: false,
      ranges: [],
    })),
    wordList: jest.fn(async () => []),
    saveWordList: jest.fn(async (words: readonly string[]) => [...words]),
    hookTitles: jest.fn(async () => [
      'He Did Not See It Coming',
      'Wait For The End',
      'The Best Save Ever',
    ]),
    voices: jest.fn(async () => ({
      enabled: true,
      voices: [
        { id: 'sim-river', name: 'River', languages: ['en'], sampleUrl: null },
        { id: 'sim-meadow', name: 'Meadow', languages: ['en', 'hi'], sampleUrl: '/sample.mp3' },
      ],
    })),
    makeVoice: jest.fn(async () => ({ job: job('voice-1', 'RUNNING'), price: 1, reused: false })),
    cancelJob: jest.fn(async () => undefined),
    useJob: useFakeJob,
    playSample: jest.fn(() => () => undefined),
    ...overrides,
  } as unknown as AiEffectsDeps & Record<string, jest.Mock>;
}

function Harness({
  initial,
  deps,
  status,
  toasts,
  playback,
  waveform,
}: {
  initial: ClipDocument;
  deps: AiEffectsDeps;
  status: ClipsAiStatus | null;
  toasts: string[];
  playback: PlaybackStore;
  waveform: ClipWaveform | null;
}) {
  const [doc, setDoc] = useState(initial);
  const latest = useRef(doc);
  latest.current = doc;
  return (
    <TooltipProvider>
      <EffectsPanel
        document={doc}
        selection={null}
        fps={30}
        playback={playback}
        onBlur={() => undefined}
        filmstrip={null}
        onAddZoom={() => undefined}
        onZoom={() => undefined}
        onZoomTiming={() => undefined}
        onRemoveZoom={() => undefined}
        onSpeed={() => undefined}
        onLooks={() => undefined}
        onFades={() => undefined}
        ai={{
          orgId: 'org-1',
          clipId: 'clip-1',
          videoId: VIDEO,
          videoDurationMs: 600_000,
          waveform,
          status,
          onEdit: (change, sentence) => {
            const next = change(latest.current);
            if (next === latest.current) return false;
            latest.current = next;
            setDoc(next);
            toasts.push(sentence);
            return true;
          },
          flushRevision: async () => 7,
          deps,
        }}
      />
      <output data-testid="doc">{JSON.stringify(doc)}</output>
    </TooltipProvider>
  );
}

const STATUS_ON = { service: 'ok', captions: true, voice: true } as unknown as ClipsAiStatus;
const STATUS_NO_VOICE = { service: 'ok', captions: true, voice: false } as unknown as ClipsAiStatus;

function setup(
  options: {
    deps?: AiEffectsDeps;
    status?: ClipsAiStatus | null;
    doc?: ClipDocument;
    waveform?: ClipWaveform | null;
  } = {},
) {
  jobs.current = null;
  const deps = (options.deps ?? fakeDeps()) as AiEffectsDeps & Record<string, jest.Mock>;
  const toasts: string[] = [];
  const playback = new PlaybackStore();
  jest.spyOn(playback, 'seekMs').mockImplementation(() => undefined);
  jest.spyOn(playback, 'play').mockImplementation(() => undefined);
  render(
    <Harness
      initial={options.doc ?? clip()}
      deps={deps}
      status={options.status === undefined ? STATUS_ON : options.status}
      toasts={toasts}
      playback={playback}
      waveform={options.waveform ?? null}
    />,
  );
  const doc = (): ClipDocument => JSON.parse(screen.getByTestId('doc').textContent ?? '{}');
  const card = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
  return { deps, toasts, playback, doc, card };
}

describe('the AI cards', () => {
  it('shows four rows with their lines when Text To Speech is on', () => {
    const { card } = setup();
    for (const [name, line] of [
      ['Bleep Bad Words', 'Hide words platforms do not like'],
      ['Add Hook Title', 'A line on the first seconds'],
      ['Add Hook Clip', 'Open with the best moment'],
      ['Text To Speech', 'Turn words into a voice'],
    ]) {
      expect(card(name as string)).toHaveTextContent(line as string);
    }
  });

  it('hides Text To Speech while it is off', () => {
    setup({ status: STATUS_NO_VOICE });
    expect(screen.queryByRole('button', { name: /^Text To Speech/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Add Hook Clip/ })).toBeInTheDocument();
  });
});

describe('Bleep Bad Words', () => {
  it('ticks every word found when turned on, unticks one, mutes, seeks and turns off', async () => {
    const { card, doc, toasts, playback } = setup();
    fireEvent.click(card('Bleep Bad Words'));
    const toggle = await screen.findByRole('switch', { name: 'Bleep Words' });
    fireEvent.click(toggle);
    expect(doc().bleeps).toHaveLength(2);
    expect(toasts).toEqual(['Bad words bleeped.']);

    const rows = screen.getAllByTestId('clip-bleep-word');
    expect(rows.map((row) => row.textContent)).toEqual(['shit,0:02', 'bastards!0:10']);
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeChecked();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Bleep shit,' }));
    expect(doc().bleeps).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: 'Bleep shit,' })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(doc().bleeps.every((bleep) => bleep.mode === 'mute')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /^Go to bastards!/ }));
    expect(playback.seekMs).toHaveBeenCalledWith(10_000);

    fireEvent.click(toggle);
    expect(doc().bleeps).toEqual([]);
    expect(toasts.at(-1)).toBe('Bleeps removed.');
  });

  it('says so when nothing is found', async () => {
    const deps = fakeDeps({
      spokenWords: jest.fn(async () => wordsView([word(1, 'hello', 12_000)])),
    });
    const { card } = setup({ deps });
    fireEvent.click(card('Bleep Bad Words'));
    fireEvent.click(await screen.findByRole('switch', { name: 'Bleep Words' }));
    expect(screen.getByText('No words to bleep in this clip.')).toBeInTheDocument();
  });

  it('offers Listen To This Clip with its price when the clip was never listened to', async () => {
    const deps = fakeDeps({ spokenWords: jest.fn(async () => wordsView(null, 3)) });
    const { card } = setup({ deps });
    fireEvent.click(card('Bleep Bad Words'));
    const listen = await screen.findByRole('button', {
      name: 'Listen To This Clip (3 AI Minutes)',
    });
    fireEvent.click(listen);
    await waitFor(() =>
      expect(deps.listen).toHaveBeenCalledWith(VIDEO, { fromMs: 0, toMs: 70_000 }),
    );
    expect(await screen.findByTestId('clip-bleep-listening')).toBeInTheDocument();
    // Module 16: the step under the bar is read out as it changes.
    expect(
      within(screen.getByTestId('clip-bleep-listening')).getByRole('status'),
    ).not.toBeEmptyDOMElement();
  });

  it('My Words saves the list and bleeps a word it adds', async () => {
    const { card, deps, doc } = setup();
    fireEvent.click(card('Bleep Bad Words'));
    fireEvent.click(await screen.findByRole('switch', { name: 'Bleep Words' }));
    expect(doc().bleeps).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'My Words' }));
    const dialog = await screen.findByTestId('clip-my-words-dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('Enter your word'), {
      target: { value: '  Darn ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(within(dialog).getByText('darn')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    });
    expect(deps.saveWordList).toHaveBeenCalledWith(['darn']);
    await waitFor(() => expect(doc().bleeps).toHaveLength(3));
    expect(screen.getAllByTestId('clip-bleep-word')).toHaveLength(3);
  });

  it('My Words adds each typed word on its own, at most 40 characters each', async () => {
    const { card, deps } = setup();
    fireEvent.click(card('Bleep Bad Words'));
    fireEvent.click(await screen.findByRole('button', { name: 'My Words' }));
    const dialog = await screen.findByTestId('clip-my-words-dialog');
    const input = within(dialog).getByPlaceholderText('Enter your word');
    expect(input).toHaveAttribute('maxLength', '40');
    fireEvent.change(input, { target: { value: ' Two   Words ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    });
    expect(deps.saveWordList).toHaveBeenCalledWith(['two', 'words']);
  });

  it('My Words shows a refusal as its sentence', async () => {
    const sentence = 'Each entry must be one word, with no spaces.';
    const deps = fakeDeps({
      saveWordList: jest.fn(async () => {
        throw new ApiError(sentence, 422, 'word_list_one_word');
      }),
    });
    const { card } = setup({ deps });
    fireEvent.click(card('Bleep Bad Words'));
    fireEvent.click(await screen.findByRole('button', { name: 'My Words' }));
    const dialog = await screen.findByTestId('clip-my-words-dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('Enter your word'), {
      target: { value: 'two words' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    });
    expect(await within(dialog).findByText(sentence)).toBeInTheDocument();
  });
});

describe('Add Hook Title', () => {
  it('shows a ghost, then three titles; a tile and Add put it on the first seconds', async () => {
    let answer: (titles: string[]) => void = () => undefined;
    const deps = fakeDeps({
      hookTitles: jest.fn(
        () =>
          new Promise<string[]>((resolve) => {
            answer = resolve;
          }),
      ),
    });
    const { card, doc, toasts } = setup({ deps });
    fireEvent.click(card('Add Hook Title'));
    expect(screen.getByTestId('clip-hook-title-loading')).toBeInTheDocument();
    await act(async () => answer(['One', 'Two', 'Three']));
    const tiles = screen.getAllByTestId('clip-hook-title-tile');
    expect(tiles.map((tile) => tile.textContent)).toEqual(['One', 'Two', 'Three']);

    fireEvent.click(tiles[1] as HTMLElement);
    expect(screen.getByPlaceholderText('Enter your title')).toHaveValue('Two');
    fireEvent.click(screen.getByRole('button', { name: 'Hook Box' }));
    fireEvent.click(screen.getByTestId('clip-hook-title-add'));
    const title = hookTitleOf(doc());
    expect(title).toMatchObject({ text: 'Two', start: 0, hookTitle: true });
    expect(title?.style.font).toBe('Montserrat');
    expect(toasts).toEqual(['Hook title added.']);
  });

  it('Try Again sends a higher attempt each time, so the titles are new', async () => {
    const hookTitles = jest.fn(async (_clipId: string, attempt: number) => [
      `First ${attempt}`,
      `Second ${attempt}`,
      `Third ${attempt}`,
    ]);
    const { card } = setup({ deps: fakeDeps({ hookTitles }) });
    fireEvent.click(card('Add Hook Title'));
    await screen.findByText('First 0');
    for (const attempt of [1, 2]) {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
      });
      expect(await screen.findByText(`First ${attempt}`)).toBeInTheDocument();
    }
    expect(hookTitles.mock.calls.map((call) => call[1])).toEqual([0, 1, 2]);
  });

  it('Try Again asks for three more, and a refusal shows its sentence', async () => {
    const sentence = 'You asked for hook titles too often. Try again in a minute.';
    const hookTitles = jest
      .fn()
      .mockResolvedValueOnce(['One', 'Two', 'Three'])
      .mockRejectedValueOnce(new ApiError(sentence, 429, 'hook_titles_throttled'));
    const { card } = setup({ deps: fakeDeps({ hookTitles }) });
    fireEvent.click(card('Add Hook Title'));
    await screen.findAllByTestId('clip-hook-title-tile');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    });
    expect(hookTitles).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(sentence)).toBeInTheDocument();
  });

  it('typing a title of your own also works', async () => {
    const { card, doc } = setup();
    fireEvent.click(card('Add Hook Title'));
    const field = screen.getByPlaceholderText('Enter your title');
    expect(screen.getByTestId('clip-hook-title-add')).toBeDisabled();
    fireEvent.change(field, { target: { value: 'My own line' } });
    fireEvent.click(screen.getByTestId('clip-hook-title-add'));
    expect(hookTitleOf(doc())?.text).toBe('My own line');
    await screen.findAllByTestId('clip-hook-title-tile');
  });
});

describe('Add Hook Clip', () => {
  it('picks the loudest second once the stored waveform arrives, beside the spoken words', async () => {
    // 20 peaks a second, stored as the import stores it: a JSON array. Quiet,
    // then a burst from 30 s to 32 s of the video (20 s to 22 s of the clip).
    const stored = Array.from({ length: 1_200 }, (_, k) => (k >= 600 && k < 640 ? 15 : 2));
    let arrive: () => void = () => undefined;
    const fetched = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    const fetchMock = jest.fn(async () => {
      await fetched;
      const text = JSON.stringify(stored);
      return {
        ok: true,
        arrayBuffer: async () => Uint8Array.from(text, (char) => char.charCodeAt(0)).buffer,
      };
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      // Words the suggestion's edges cut through: 29.1 s and 31.6 s of the video.
      const spoken = [...WORDS, word(6, 'wait', 29_100), word(7, 'for', 31_600)];
      const deps = fakeDeps({ spokenWords: jest.fn(async () => wordsView(spoken)) });
      const waveform: ClipWaveform = {
        url: 'https://space.test/hook-waveform.json',
        meta: { perSecond: 20, count: stored.length },
        expiresAt: '2099-01-01T00:00:00.000Z',
      } as ClipWaveform;
      const { card } = setup({ deps, waveform });
      fireEvent.click(card('Add Hook Clip'));
      // Before the peaks: the clip's first seconds.
      expect(screen.getByTestId('clip-hook-range')).toHaveTextContent('From 0:00, 2.5 s long');

      await act(async () => {
        arrive();
        await fetched;
      });
      // The burst's loudest second is centred at 30.5 s (20.5 s of the clip),
      // its edges moved out to the words they cut: 19.1 s to 21.9 s.
      await waitFor(() =>
        expect(screen.getByRole('slider', { name: 'Hook Start' })).toHaveAttribute(
          'aria-valuenow',
          '19100',
        ),
      );
      expect(screen.getByRole('slider', { name: 'Hook End' })).toHaveAttribute(
        'aria-valuenow',
        '22000',
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('keeps the range to 1 to 5 seconds, previews, adds and removes the hook', async () => {
    const { card, doc, toasts, playback } = setup();
    fireEvent.click(card('Add Hook Clip'));
    const text = screen.getByTestId('clip-hook-range');
    expect(text).toHaveTextContent('From 0:00, 2.5 s long');

    const end = screen.getByRole('slider', { name: 'Hook End' });
    for (let k = 0; k < 10; k += 1) fireEvent.keyDown(end, { key: 'ArrowRight', shiftKey: true });
    expect(text).toHaveTextContent('From 0:00, 5 s long');
    for (let k = 0; k < 10; k += 1) fireEvent.keyDown(end, { key: 'ArrowLeft', shiftKey: true });
    expect(text).toHaveTextContent('From 0:00, 1 s long');
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Hook Position' }), {
      key: 'ArrowRight',
      shiftKey: true,
    });
    expect(text).toHaveTextContent('From 0:01, 1 s long');
    fireEvent.keyDown(end, { key: 'ArrowRight', shiftKey: true });
    expect(text).toHaveTextContent('From 0:01, 2 s long');

    fireEvent.click(screen.getByTestId('clip-hook-preview'));
    expect(playback.seekMs).toHaveBeenCalledWith(1_000);
    expect(playback.play).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('clip-hook-add'));
    const hooked = doc();
    expect(hooked.segments).toHaveLength(2);
    expect(hooked.segments[0]).toMatchObject({ role: 'hook', sourceIn: 11_000, sourceOut: 13_000 });
    expect(toasts).toEqual(['Hook added. The clip now opens with it.']);
    expect(screen.getByTestId('clip-hook-length')).toHaveTextContent('Hook: 2 s');

    fireEvent.click(screen.getByRole('button', { name: 'Remove Hook' }));
    expect(doc().segments).toHaveLength(1);
    expect(doc().segments[0]?.role).toBeUndefined();
    expect(toasts.at(-1)).toBe('Hook removed.');
  });
});

describe('Text To Speech', () => {
  it('prices the line, makes the voice and puts it at the playhead', async () => {
    const { card, deps, doc, toasts } = setup();
    fireEvent.click(card('Text To Speech'));
    await screen.findByRole('radio', { name: 'River' });
    // A voice without a sample has no play button.
    expect(screen.queryByRole('button', { name: 'Play River' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Play Meadow' })).toBeInTheDocument();

    const make = screen.getByTestId('clip-voice-make');
    expect(make).toHaveTextContent('Make The Voice (1 AI Minute)');
    expect(make).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Enter your words'), {
      target: { value: 'Welcome back to the channel' },
    });
    expect(screen.getByTestId('clip-voice-count')).toHaveTextContent('27 / 500');
    await act(async () => {
      fireEvent.click(make);
    });
    expect(deps.makeVoice).toHaveBeenCalledWith('clip-1', {
      text: 'Welcome back to the channel',
      voiceId: 'sim-river',
      revision: 7,
    });
    act(() => jobs.set(job('voice-1', 'RUNNING')));
    expect(screen.getByTestId('clip-voice-progress')).toBeInTheDocument();
    // Module 16: the step under the bar is read out as it changes.
    expect(
      within(screen.getByTestId('clip-voice-progress')).getByRole('status'),
    ).not.toBeEmptyDOMElement();

    act(() => jobs.set(job('voice-1', 'DONE', { assetId: 'asset-7', durationMs: 2_000 })));
    await waitFor(() => expect(countSounds(doc())).toBe(1));
    expect(toasts).toEqual(['Voice added at the playhead.']);
    expect(screen.queryByTestId('clip-voice-progress')).toBeNull();
  });

  it('adds the voice again when the same line hands back the finished job', async () => {
    const done = job('voice-1', 'DONE', { assetId: 'asset-7', durationMs: 2_000 });
    const deps = fakeDeps({
      makeVoice: jest
        .fn()
        .mockResolvedValueOnce({ job: job('voice-1', 'RUNNING'), price: 1, reused: false })
        .mockResolvedValueOnce({ job: done, price: 0, reused: true }),
    });
    const { card, doc, toasts } = setup({ deps });
    fireEvent.click(card('Text To Speech'));
    await screen.findByRole('radio', { name: 'River' });
    fireEvent.change(screen.getByPlaceholderText('Enter your words'), {
      target: { value: 'Welcome back' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('clip-voice-make'));
    });
    act(() => jobs.set(done));
    await waitFor(() => expect(countSounds(doc())).toBe(1));

    await act(async () => {
      fireEvent.click(screen.getByTestId('clip-voice-make'));
    });
    await waitFor(() => expect(countSounds(doc())).toBe(2));
    expect(toasts).toEqual(['Voice added at the playhead.', 'Voice added at the playhead.']);
    expect(screen.queryByTestId('clip-voice-progress')).toBeNull();
    expect(screen.getByTestId('clip-voice-make')).toBeEnabled();
  });

  it('says when the voice cannot read the language', async () => {
    const deps = fakeDeps({
      makeVoice: jest.fn(async () => {
        throw new ApiError(
          'This voice cannot read this language. Pick another voice.',
          422,
          'voice_language',
        );
      }),
    });
    const { card } = setup({ deps });
    fireEvent.click(card('Text To Speech'));
    await screen.findByRole('radio', { name: 'River' });
    fireEvent.change(screen.getByPlaceholderText('Enter your words'), {
      target: { value: 'नमस्ते' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('clip-voice-make'));
    });
    expect(screen.getByTestId('clip-voice-problem')).toHaveTextContent(
      'This voice cannot read this language. Pick another voice.',
    );
  });

  it('shows the minutes sentence with See Plans on a 402', async () => {
    const deps = fakeDeps({
      makeVoice: jest.fn(async () => {
        throw new ApiError("You have used this month's AI minutes.", 402, 'clips_ai_minutes_used');
      }),
    });
    const { card } = setup({ deps });
    fireEvent.click(card('Text To Speech'));
    await screen.findByRole('radio', { name: 'River' });
    fireEvent.change(screen.getByPlaceholderText('Enter your words'), { target: { value: 'Hi' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('clip-voice-make'));
    });
    const problem = screen.getByTestId('clip-voice-problem');
    expect(problem).toHaveTextContent("You have used this month's AI minutes.");
    expect(within(problem).getByRole('link', { name: 'See Plans' })).toHaveAttribute(
      'href',
      '/org-1/settings/billing',
    );
  });
});
