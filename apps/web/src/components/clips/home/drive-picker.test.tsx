/**
 * Pick From Google Drive (Module 12, D13-09): the stand-in picker under
 * simulation sends the picked made-up file to the API and hands the answer
 * on as a new import; a refusal is a warning toast; no Drive, no button.
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { importFromDrive } from '@/lib/clips-api';
import type { ClipImportOutcome } from '@/types/clips';
import { useDrivePicker } from './drive-picker';

jest.mock('@/lib/clips-api', () => ({ importFromDrive: jest.fn() }));
jest.mock('@/lib/google-drive-picker', () => ({ pickFromGoogleDrive: jest.fn() }));
const toast = jest.fn();
jest.mock('@postgear/ui', () => ({
  ...jest.requireActual('@postgear/ui'),
  toast: (...args: unknown[]) => toast(...args),
}));

const SIMULATED = { available: true, simulated: true, fileId: 'sim-drive-talk-0001' } as const;

function Harness({ onImported }: { onImported: (outcome: ClipImportOutcome) => void }) {
  const picker = useDrivePicker(SIMULATED, false, onImported);
  return (
    <>
      <button type="button" onClick={picker.onPick}>
        Open
      </button>
      {picker.dialog}
    </>
  );
}

describe('useDrivePicker', () => {
  // jsdom has no matchMedia; the buttons' hover fill asks it about reduced motion.
  beforeAll(() => {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  });
  beforeEach(() => jest.clearAllMocks());

  it('offers nothing when Drive is not offered, or the tools are off', () => {
    const off = renderHook(() => useDrivePicker({ available: false }, false, jest.fn()));
    expect(off.result.current.onPick).toBeUndefined();
    expect(off.result.current.dialog).toBeNull();
    const toolsOff = renderHook(() => useDrivePicker(SIMULATED, true, jest.fn()));
    expect(toolsOff.result.current.onPick).toBeUndefined();
  });

  it('sends the picked made-up file and hands the answer on as a new import', async () => {
    const answer = { video: { id: 'video-1' }, job: { id: 'job-1' } };
    (importFromDrive as jest.Mock).mockResolvedValue(answer);
    const onImported = jest.fn();
    render(<Harness onImported={onImported} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog', { name: 'Pick From Google Drive' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Sample Stream/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pick This File' }));
    });

    expect(importFromDrive).toHaveBeenCalledWith('sim-drive-stream-0001', expect.any(String));
    expect(onImported).toHaveBeenCalledWith({ ...answer, existing: false });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows a refusal as a warning and keeps the dialog open', async () => {
    (importFromDrive as jest.Mock).mockRejectedValue(new Error('Pick it again from Google Drive.'));
    const onImported = jest.fn();
    render(<Harness onImported={onImported} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pick This File' }));
    });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' }));
    expect(onImported).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
