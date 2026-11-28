import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError } from '@/lib/api';
import { TranscriptDownloadMenu } from './transcript-download-menu';

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  downloadFile: jest.fn(async () => undefined),
}));

const { downloadFile } = jest.requireMock('@/lib/api') as { downloadFile: jest.Mock };

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

beforeEach(() => downloadFile.mockReset());

function renderMenu(props: { language?: string } = {}) {
  const onError = jest.fn();
  render(
    <TooltipProvider>
      <TranscriptDownloadMenu
        path="/clips/clip-1/transcript/download"
        title="Transcript"
        onError={onError}
        {...props}
      />
    </TooltipProvider>,
  );
  fireEvent.keyDown(screen.getByRole('button', { name: 'Download Transcript' }), { key: 'Enter' });
  return onError;
}

describe('Download Transcript (Module 17 item 10)', () => {
  it('offers a text file and subtitles, and asks the API for the one picked', async () => {
    renderMenu();
    expect(await screen.findByRole('menuitem', { name: 'Text File' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Subtitles (SRT)' }));
    await waitFor(() =>
      expect(downloadFile).toHaveBeenCalledWith(
        '/clips/clip-1/transcript/download?format=srt',
        'Transcript.srt',
      ),
    );
  });

  it('names a language when one is given', async () => {
    renderMenu({ language: 'ta' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Text File' }));
    await waitFor(() =>
      expect(downloadFile).toHaveBeenCalledWith(
        '/clips/clip-1/transcript/download?format=txt&language=ta',
        'Transcript.txt',
      ),
    );
  });

  it("hands on the API's own sentence, and a plain one when the connection dropped", async () => {
    downloadFile.mockRejectedValueOnce(
      new ApiError(
        'This part of the video has not been listened to yet.',
        409,
        'transcript_missing',
      ),
    );
    const onError = renderMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Text File' }));
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith('This part of the video has not been listened to yet.'),
    );

    downloadFile.mockRejectedValueOnce(new ApiError('Interrupted.', 0));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Download Transcript' }), {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Text File' }));
    await waitFor(() =>
      expect(onError).toHaveBeenLastCalledWith(
        'The download did not work. Check your connection and try again.',
      ),
    );
  });
});
