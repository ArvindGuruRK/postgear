/**
 * The Captions tab (Sprint 13, Module 03): what it offers before a clip has
 * captions, the price on the button, the service-off state, and the words
 * fixed in place as one undo step each.
 */
import {
  builtInCaptionStyle,
  type CaptionLook,
  type CaptionsTrack,
  captionLayout,
  createCaptionsTrack,
  createClipDocument,
  withCaptionsTrack,
} from '@postgear/video-engine';
import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { TranscriptView } from '@/types/clips';
import { CaptionsPanel, type CaptionsPanelProps } from './captions-panel';
import type { CaptionsState } from './use-captions';

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

const VIDEO = '6f1c2b1e-8d4a-4c1e-9b7a-2f3e4d5c6b7a';
const TRANSCRIPT = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const look = (id: string) => builtInCaptionStyle(id)?.look as CaptionLook;

function heard(): TranscriptView {
  return {
    id: TRANSCRIPT,
    language: 'en',
    model: 'test',
    source: 'listened',
    covered: [{ fromMs: 0, toMs: 10_000 }],
    fixes: 0,
    fileName: null,
    words: ['So', 'tooday', 'we'].map((text, i) => ({
      i,
      start: 1_000 + i * 400,
      end: 1_000 + i * 400 + 320,
      text,
      sure: i === 1 ? 0.2 : 0.95,
    })),
  };
}

function state(overrides: Partial<CaptionsState> = {}): CaptionsState {
  return {
    transcript: null,
    loading: false,
    missing: false,
    price: 2,
    styles: [],
    stylesInfo: { own: 0, limit: 30 },
    ai: {
      service: 'ok',
      prices: {} as never,
      captions: true,
      languages: [
        { code: 'en', name: 'English', highlight: 'word' },
        { code: 'ta', name: 'Tamil', highlight: 'page' },
      ],
    },
    busy: null,
    job: null,
    problem: null,
    note: null,
    dismiss: jest.fn(),
    add: jest.fn(),
    cancelListening: jest.fn(),
    upload: jest.fn(),
    translate: jest.fn(),
    replaceEverywhere: jest.fn(async () => 3),
    saveStyle: jest.fn(),
    renameStyle: jest.fn(),
    removeStyle: jest.fn(),
    ...overrides,
  };
}

function withCaptions() {
  const track = createCaptionsTrack({
    transcriptAssetId: TRANSCRIPT,
    language: 'en',
    styleId: 'bold-pop',
    look: look('bold-pop'),
  });
  const doc = withCaptionsTrack(
    createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 10_000, ratio: '9:16' }),
    track,
  );
  const transcript = heard();
  const layout = captionLayout({ doc, track, look: look('bold-pop'), transcript, wordTimed: true });
  return { track, layout, transcript };
}

function show(props: Partial<CaptionsPanelProps> = {}) {
  const onEdit = jest.fn();
  const all: CaptionsPanelProps = {
    track: null,
    layout: null,
    captions: state(),
    translatePrice: 1,
    recent: [],
    onRecent: jest.fn(),
    safeArea: false,
    onSafeArea: jest.fn(),
    onEdit,
    onRemove: jest.fn(),
    onSeek: jest.fn(),
    onNotice: jest.fn(),
    ...props,
  };
  render(
    <TooltipProvider>
      <CaptionsPanel {...all} />
    </TooltipProvider>,
  );
  return { ...all, onEdit };
}

/** The track a recorded `onEdit` call would make from `from`. */
function applied(onEdit: jest.Mock, from: CaptionsTrack, call = 0): CaptionsTrack {
  const change = (onEdit.mock.calls[call] ?? [])[0] as
    | ((track: CaptionsTrack) => CaptionsTrack)
    | undefined;
  if (!change) throw new Error('no edit was made');
  return change(from);
}

describe('before a clip has captions', () => {
  it('offers the six styles and Add Captions with its price, and adds in the picked style', () => {
    const { captions } = show();
    for (const name of ['Bold Pop', 'Marker', 'Karaoke', 'Clean', 'Boxed', 'Typewriter']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    const add = screen.getByTestId('clip-captions-add');
    expect(add).toHaveTextContent('Add Captions (2 AI Minutes)');
    fireEvent.click(screen.getByRole('button', { name: 'Karaoke' }));
    fireEvent.click(add);
    expect(captions.add).toHaveBeenCalledWith({ styleId: 'karaoke', language: 'auto' });
  });

  it('says nothing about a price when the clip was already listened to', () => {
    show({ captions: state({ price: 0 }) });
    expect(screen.getByTestId('clip-captions-add')).toHaveTextContent(/^Add Captions$/);
  });

  it('says the service is off, keeps Add Captions off and the file upload on', () => {
    const captions = state({ ai: { service: 'off', prices: {} as never, captions: false } });
    show({ captions });
    expect(screen.getByTestId('clip-captions-off')).toHaveTextContent(
      'Captions from speech are not available right now. You can still upload a captions file.',
    );
    expect(screen.getByTestId('clip-captions-add')).toBeDisabled();
    const upload = screen.getByRole('button', { name: 'Upload A Captions File' });
    expect(upload).toBeEnabled();
    const file = new File(['1\n00:00:01,000 --> 00:00:02,000\nHi\n'], 'mine.srt');
    fireEvent.change(screen.getByTestId('clip-captions-file'), { target: { files: [file] } });
    expect(captions.upload).toHaveBeenCalledWith(file, { styleId: 'bold-pop', language: 'auto' });
  });

  it('shows how far listening is, with a way to stop it', () => {
    const captions = state({ job: { id: 'job-1', progress: 40, status: 'RUNNING' } as never });
    show({ captions });
    expect(screen.getByTestId('clip-captions-listening')).toHaveTextContent(
      'Listening to this clip. You can keep editing.',
    );
    expect(screen.queryByTestId('clip-captions-add')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(captions.cancelListening).toHaveBeenCalled();
  });

  it('shows a refusal as one sentence', () => {
    show({ captions: state({ problem: 'We could not hear any speech in this video.' }) });
    expect(screen.getByTestId('clip-captions-problem')).toHaveTextContent(
      'We could not hear any speech in this video.',
    );
  });
});

describe('with captions', () => {
  it('changes the style as one edit that takes the style size and words at once', () => {
    const { track, layout, transcript } = withCaptions();
    const { onEdit } = show({ track, layout, captions: state({ transcript }) });
    fireEvent.click(screen.getByRole('button', { name: 'Clean' }));
    expect(applied(onEdit, track)).toMatchObject({ styleId: 'clean', sizePx: 62, maxWords: 6 });
  });

  it('marks an unsure word, and fixes a word in place for this clip', () => {
    const { track, layout, transcript } = withCaptions();
    const { onEdit } = show({ track, layout, captions: state({ transcript }) });
    const words = screen.getAllByTestId('clip-caption-word');
    expect(words.map((word) => word.textContent)).toEqual(['SO', 'TOODAY', 'WE']);
    expect(words[1]).toHaveAttribute('data-state', 'unsure');
    expect(words[1]).toHaveAccessibleName('TOODAY, not sure');

    fireEvent.click(words[1] as HTMLElement);
    const open = screen.getByTestId('clip-caption-word-open');
    const field = within(open).getByRole('textbox');
    expect(field).toHaveValue('tooday');
    expect(field).toHaveAttribute('placeholder', 'Enter your word');
    fireEvent.change(field, { target: { value: 'today' } });
    fireEvent.click(within(open).getByRole('button', { name: 'Save' }));
    expect(applied(onEdit, track).edits).toEqual({ 1: { text: 'today' } });
    expect(screen.queryByTestId('clip-caption-word-open')).toBeNull();
  });

  it('hides a word from this clip, and fixes a word everywhere in the video', async () => {
    const { track, layout, transcript } = withCaptions();
    const captions = state({ transcript });
    const { onEdit } = show({ track, layout, captions });
    fireEvent.click(screen.getAllByTestId('clip-caption-word')[1] as HTMLElement);
    const open = screen.getByTestId('clip-caption-word-open');

    fireEvent.change(within(open).getByRole('textbox'), { target: { value: 'today' } });
    fireEvent.click(within(open).getByRole('button', { name: 'Replace Everywhere' }));
    expect(captions.replaceEverywhere).toHaveBeenCalledWith('tooday', 'today');
    expect(await within(open).findByRole('status')).toHaveTextContent(
      'Changed 3 words in this video.',
    );

    fireEvent.click(within(open).getByRole('button', { name: 'Hide Word' }));
    expect(applied(onEdit, track, onEdit.mock.calls.length - 1).edits).toEqual({
      1: { hidden: true },
    });
  });

  it('offers Replace Everywhere only for words that were listened to', () => {
    const { track, layout, transcript } = withCaptions();
    show({
      track,
      layout,
      captions: state({ transcript: { ...transcript, source: 'supplied', fileName: 'mine.srt' } }),
    });
    expect(screen.getByText('From your file: mine.srt')).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId('clip-caption-word')[0] as HTMLElement);
    expect(screen.queryByRole('button', { name: 'Replace Everywhere' })).toBeNull();
  });

  it('translates to another language with the price on the button, never to its own', () => {
    const { track, layout, transcript } = withCaptions();
    const captions = state({ transcript });
    show({ track, layout, captions, translatePrice: 1 });
    const button = screen.getByTestId('clip-captions-translate');
    expect(button).toHaveTextContent('Translate To Tamil (1 AI Minute)');
    fireEvent.click(button);
    expect(captions.translate).toHaveBeenCalledWith('ta');
  });

  it('toggles the Safe Area Guide, jumps to a line, and removes the captions', () => {
    const { track, layout, transcript } = withCaptions();
    const props = show({ track, layout, captions: state({ transcript }) });
    fireEvent.click(screen.getByRole('switch', { name: 'Safe Area Guide' }));
    expect(props.onSafeArea).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Go to 0:01.0' }));
    expect(props.onSeek).toHaveBeenCalledWith(1_000);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Captions' }));
    expect(props.onRemove).toHaveBeenCalled();
  });

  it('has no Safe Area Guide where the shape has none, and says when the captions are gone', () => {
    const { track, layout } = withCaptions();
    show({ track, layout, onSafeArea: null, captions: state({ missing: true }) });
    expect(screen.queryByRole('switch', { name: 'Safe Area Guide' })).toBeNull();
    expect(screen.getByTestId('clip-captions-gone')).toBeInTheDocument();
  });
});
