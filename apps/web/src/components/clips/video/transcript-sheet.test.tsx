import { TooltipProvider } from '@postgear/ui';
import type { TranscriptWord } from '@postgear/video-engine';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { TranscriptSheet } from './transcript-sheet';

jest.mock('@/lib/clips-api', () => ({
  getVideoTranscript: jest.fn(),
  listenToVideo: jest.fn(),
}));
jest.mock('../use-clip-job', () => ({ useClipJob: () => ({ job: null, error: null }) }));

const api = jest.requireMock('@/lib/clips-api') as Record<string, jest.Mock>;

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

function words(spec: Array<[string, number, number]>): TranscriptWord[] {
  return spec.map(([text, start, end], i) => ({ i, start, end, text, sure: 0.9 }));
}

const SAID = words([
  ['So,', 1_000, 1_200],
  ['what', 1_300, 1_500],
  ['we', 1_550, 1_700],
  ['learned', 1_750, 2_200],
  ['is', 2_250, 2_400],
  ['simple.', 2_450, 2_900],
  ['Ship', 3_000, 3_300],
  ['small,', 3_350, 3_800],
  ['learned', 3_850, 4_300],
  ['fast.', 4_350, 4_900],
]);

function transcript(covered = [{ fromMs: 0, toMs: 30_000 }]) {
  return {
    transcript: {
      id: 'tr',
      language: 'en',
      model: 'simulation',
      source: 'listened',
      words: SAID,
      covered,
      fixes: 0,
      fileName: null,
    },
    complete: false,
    price: 0,
  };
}

/** Opens the sheet once the page knows the video has a transcript. */
async function openSheet() {
  const button = await screen.findByTestId('clip-video-transcript');
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

function setup() {
  const onSeek = jest.fn();
  const onCreateClip = jest.fn(async () => undefined);
  render(
    <TooltipProvider>
      <TranscriptSheet
        orgId="org-1"
        videoId={VIDEO}
        durationMs={60_000}
        onSeek={onSeek}
        onCreateClip={onCreateClip}
      />
    </TooltipProvider>,
  );
  return { onSeek, onCreateClip };
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
});

describe('TranscriptSheet', () => {
  it('offers Listen To This Video with the whole length price when nothing was heard', async () => {
    api.getVideoTranscript?.mockResolvedValue({ transcript: null, complete: false, price: 1 });
    api.listenToVideo?.mockResolvedValue({ covered: true, language: 'en', price: 0 });
    setup();
    const button = await screen.findByTestId('clip-video-listen');
    expect(button).toHaveTextContent('Listen To This Video (2 AI Minutes)');
    fireEvent.click(button);
    await waitFor(() => expect(api.listenToVideo).toHaveBeenCalledWith(VIDEO, {}));
  });

  it('opens on the words, with the unheard rest as a gap with its own Listen', async () => {
    api.getVideoTranscript?.mockResolvedValue(transcript());
    setup();
    await openSheet();
    const sheet = await screen.findByTestId('clip-video-transcript-sheet');
    expect(within(sheet).getByText('simple.')).toBeInTheDocument();
    const gap = within(sheet).getByTestId('clip-transcript-gap');
    expect(gap).toHaveTextContent('Not listened to yet');
    expect(within(gap).getByRole('button')).toHaveTextContent('Listen (2 AI Minutes)');
  });

  it('finds words, steps through the matches and moves the player to each', async () => {
    api.getVideoTranscript?.mockResolvedValue(transcript());
    const { onSeek } = setup();
    await openSheet();
    const sheet = await screen.findByTestId('clip-video-transcript-sheet');
    await within(sheet).findByText('simple.');
    const find = within(sheet).getByLabelText('Find in the transcript');
    fireEvent.change(find, { target: { value: 'learn' } });
    expect(within(sheet).getByText('1 of 2')).toBeInTheDocument();
    expect(sheet.querySelectorAll('[data-match="true"]')).toHaveLength(2);
    fireEvent.keyDown(find, { key: 'Enter' });
    expect(within(sheet).getByText('2 of 2')).toBeInTheDocument();
    expect(onSeek).toHaveBeenLastCalledWith(3_850);
    // Ctrl+F inside the sheet goes to the find field.
    find.blur();
    fireEvent.keyDown(sheet, { key: 'f', ctrlKey: true });
    expect(find).toHaveFocus();
  });

  it('jumps the player to a clicked word, and makes a clip of selected words', async () => {
    api.getVideoTranscript?.mockResolvedValue(transcript());
    const { onSeek, onCreateClip } = setup();
    await openSheet();
    const sheet = await screen.findByTestId('clip-video-transcript-sheet');
    const word = (text: string) => within(sheet).getByText(text);
    await within(sheet).findByText('simple.');
    fireEvent.click(word('what'));
    expect(onSeek).toHaveBeenLastCalledWith(1_300);

    const create = within(sheet).getByTestId('clip-transcript-create');
    expect(create).toBeDisabled();
    fireEvent.pointerDown(word('what'), { button: 0 });
    fireEvent.pointerEnter(word('fast.'));
    fireEvent.pointerUp(window);
    expect(create).toBeEnabled();
    fireEvent.click(create);
    await waitFor(() => expect(onCreateClip).toHaveBeenCalledWith({ fromMs: 1_150, toMs: 5_050 }));
  });

  it('keeps Create Clip off for under 3 seconds of speech, and says why', async () => {
    api.getVideoTranscript?.mockResolvedValue(transcript());
    setup();
    await openSheet();
    const sheet = await screen.findByTestId('clip-video-transcript-sheet');
    await within(sheet).findByText('simple.');
    fireEvent.pointerDown(within(sheet).getByText('what'), { button: 0 });
    fireEvent.pointerEnter(within(sheet).getByText('learned', { selector: '[data-word-id="3"]' }));
    fireEvent.pointerUp(window);
    expect(within(sheet).getByTestId('clip-transcript-create')).toBeDisabled();
    expect(
      within(sheet).getByText('Select at least 3 seconds of speech to make a clip.'),
    ).toBeInTheDocument();
  });
});
