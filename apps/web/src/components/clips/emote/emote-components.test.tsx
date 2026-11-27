import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { EmoteFileView, EmoteView } from '@/types/clips-emotes';
import { fixtureJob } from '../clips-fixtures';
import { ChatPreview } from './chat-preview';
import { CropBox, CropNote } from './crop-box';
import { EmoteResult } from './emote-result';
import { TrimBar } from './trim-bar';

beforeAll(() => stubBrowserLayout());

const FRAME = { width: 1280, height: 720 };

function file(overrides: Partial<EmoteFileView> = {}): EmoteFileView {
  return {
    name: 'emote-twitch-112.gif',
    size: 112,
    format: 'gif',
    bytes: 311_000,
    maxBytes: 512_000,
    fits: true,
    rung: 1,
    frames: 60,
    fps: 20,
    extra: false,
    url: 'https://files.example/emote-twitch-112.gif',
    ...overrides,
  };
}

function doneView(files: EmoteFileView[], expired = false): EmoteView {
  return {
    job: fixtureJob({ id: 'job-emote', kind: 'EMOTE', status: 'DONE', progress: 100 }),
    emote: {
      platform: 'twitch',
      files,
      zip: {
        name: 'emotes-twitch.zip',
        bytes: 400_000,
        url: expired ? null : 'https://files.example/z',
      },
      sharp: false,
      expiresAt: null,
      expired,
    },
  };
}

describe('ChatPreview', () => {
  it('draws five emotes on one line, switches the ground, and keeps the typed line on the page', () => {
    const renderEmote = jest.fn((index: number) => <span data-testid="emote">{index}</span>);
    render(
      <TooltipProvider>
        <ChatPreview renderEmote={renderEmote} />
      </TooltipProvider>,
    );
    const chat = screen.getByTestId('emote-chat-preview');
    expect(within(chat).getAllByTestId('emote')).toHaveLength(7);
    expect(chat.querySelector('[data-ground]')?.getAttribute('data-ground')).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Light Chat' }));
    expect(chat.querySelector('[data-ground]')?.getAttribute('data-ground')).toBe('light');
    fireEvent.change(screen.getByPlaceholderText('Enter your own chat line'), {
      target: { value: 'pog moment' },
    });
    expect(screen.getByText(/pog moment/)).toBeInTheDocument();
  });
});

describe('CropBox', () => {
  it('moves with the arrow keys and stays inside the picture', () => {
    const onChange = jest.fn();
    render(<CropBox frame={FRAME} crop={{ x: 0, y: 0, size: 200 }} onChange={onChange} />);
    const box = screen.getByRole('button', { name: 'Crop Box' });
    fireEvent.keyDown(box, { key: 'ArrowRight', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith({ x: 20, y: 0, size: 200 });
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith({ x: 0, y: 0, size: 200 });
  });

  it('says the crop will look soft under 112 source pixels', () => {
    const { rerender } = render(<CropNote crop={{ x: 0, y: 0, size: 96 }} />);
    expect(screen.getByTestId('emote-crop-note')).toHaveTextContent('This will look soft.');
    rerender(<CropNote crop={{ x: 0, y: 0, size: 112 }} />);
    expect(screen.getByTestId('emote-crop-note')).not.toHaveTextContent('soft');
  });
});

describe('TrimBar', () => {
  it('shows the length and moves the window a tenth at a time', () => {
    const onChange = jest.fn();
    render(
      <TrimBar
        durationMs={60_000}
        stretch={{ startMs: 5_000, lengthMs: 2_400 }}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId('emote-trim-length')).toHaveTextContent('2.4 s');
    expect(screen.getByText('3.0 seconds at most')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Stretch' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith({ startMs: 5_100, lengthMs: 2_400 });
  });
});

describe('EmoteResult', () => {
  it('lists each file with its size and the limit, and downloads one or all', () => {
    const onSave = jest.fn();
    render(
      <EmoteResult
        view={doneView([file(), file({ name: 'emote-twitch-56.gif', size: 56, bytes: 90_000 })])}
        onSave={onSave}
      />,
    );
    const rows = screen.getAllByTestId('emote-file-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('311 KB');
    expect(rows[0]).toHaveTextContent('Under the limit');
    fireEvent.click(screen.getByRole('button', { name: 'Download emote-twitch-56.gif' }));
    expect(onSave).toHaveBeenLastCalledWith('emote-twitch-56.gif');
    fireEvent.click(screen.getByTestId('emote-download-all'));
    expect(onSave).toHaveBeenLastCalledWith('emotes-twitch.zip');
  });

  it('marks an extra that did not fit and offers no download for it', () => {
    render(
      <EmoteResult
        view={doneView([
          file(),
          file({
            name: 'emote-seventv-256.webp',
            format: 'webp',
            size: 256,
            bytes: 8_000_000,
            maxBytes: 7_000_000,
            fits: false,
            extra: true,
            url: null,
          }),
        ])}
        onSave={jest.fn()}
      />,
    );
    const rows = screen.getAllByTestId('emote-file-row');
    expect(rows[1]).toHaveTextContent('Over the 7 MB limit');
    expect(within(rows[1] as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('shows the sentence of a too-big emote as a warning', () => {
    const sentence =
      'This emote is too big for Twitch at 112 px. Try a shorter stretch or a smaller crop.';
    render(
      <EmoteResult
        view={{
          job: fixtureJob({
            kind: 'EMOTE',
            status: 'FAILED',
            error: { code: 'emote_too_big', message: sentence },
          }),
          emote: null,
        }}
        onSave={jest.fn()}
      />,
    );
    expect(screen.getByTestId('emote-failed')).toHaveTextContent(sentence);
  });

  it('turns off the downloads once the files have expired', () => {
    render(<EmoteResult view={doneView([file({ url: null })], true)} onSave={jest.fn()} />);
    expect(screen.getByTestId('emote-download-all')).toBeDisabled();
  });
});
