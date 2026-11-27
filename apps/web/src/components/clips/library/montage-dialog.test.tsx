import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError } from '@/lib/api';
import type { ClipListItem } from '@/types/clips';
import { fixtureClipItem, fixtureClipView } from './clip-list-fixtures';
import { MontageDialog } from './montage-dialog';
import { MONTAGE_SNAPSHOT_LINE, MONTAGE_TOO_FEW } from './montage-model';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));
jest.mock('@/lib/clips-bulk-api', () => ({
  createMontage: jest.fn(),
}));
const { createMontage } = jest.requireMock('@/lib/clips-bulk-api') as { createMontage: jest.Mock };

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

beforeEach(() => {
  createMontage.mockReset();
  push.mockReset();
});

const A = fixtureClipItem({ id: 'clip-a', title: 'Team Talk', durationMs: 30_000 });
const B = fixtureClipItem({ id: 'clip-b', title: 'Big Play', durationMs: 70_000 });
const C = fixtureClipItem({ id: 'clip-c', title: 'The Save', durationMs: 20_000 });
const SQUARE = fixtureClipItem({
  id: 'clip-s',
  title: 'Square One',
  durationMs: 10_000,
  ratio: '1:1',
});

function open(clips: ClipListItem[]) {
  const onCreated = jest.fn();
  render(
    <TooltipProvider>
      <MontageDialog
        orgId="seed-demo-org"
        open
        clips={clips}
        onOpenChange={jest.fn()}
        onCreated={onCreated}
      />
    </TooltipProvider>,
  );
  return { dialog: screen.getByTestId('clips-montage-dialog'), onCreated };
}

const titles = (dialog: HTMLElement) =>
  within(dialog)
    .getAllByTestId('clips-montage-row')
    .map((row) => row.querySelector('span[title]')?.textContent);

describe('Create Montage', () => {
  it('lists the clips with their lengths, the total, and the snapshot line', () => {
    const { dialog } = open([A, B, C]);
    expect(titles(dialog)).toEqual(['Team Talk', 'Big Play', 'The Save']);
    expect(within(dialog).getByText('1:10, 9:16')).toBeInTheDocument();
    expect(within(dialog).getByTestId('clips-montage-total')).toHaveTextContent('2:00');
    expect(within(dialog).getByText(MONTAGE_SNAPSHOT_LINE)).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText('Enter your title')).toBeInTheDocument();
  });

  it('takes 0.3 s off per join with Fade', () => {
    const { dialog } = open([A, B, C]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fade' }));
    // 120 s less 0.6 s: 1:59.
    expect(within(dialog).getByTestId('clips-montage-total')).toHaveTextContent('1:59');
  });

  it('sorts the clips', () => {
    const { dialog } = open([A, B, C]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move Team Talk Down' }));
    expect(titles(dialog)).toEqual(['Big Play', 'Team Talk', 'The Save']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move The Save Up' }));
    expect(titles(dialog)).toEqual(['Big Play', 'The Save', 'Team Talk']);
    expect(within(dialog).getByRole('button', { name: 'Move Big Play Up' })).toBeDisabled();
  });

  it('asks for a shape only when the shapes differ', () => {
    const { dialog } = open([A, B]);
    expect(within(dialog).queryByTestId('clips-montage-shape')).toBeNull();
    expect(within(dialog).getByTestId('clips-montage-create')).toBeEnabled();
  });

  it('asks for one shape when the clips differ, and sends it', async () => {
    createMontage.mockResolvedValue({ clip: fixtureClipView({ id: 'clip-m', origin: 'MONTAGE' }) });
    const { dialog } = open([A, SQUARE]);
    const shape = within(dialog).getByTestId('clips-montage-shape');
    expect(within(dialog).getByTestId('clips-montage-create')).toBeDisabled();
    expect(within(dialog).getByTestId('clips-montage-why')).toHaveTextContent('Pick one shape');
    fireEvent.click(within(shape).getByRole('button', { name: 'Vertical' }));
    expect(within(dialog).getByTestId('clips-montage-create')).toBeEnabled();
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId('clips-montage-create'));
    });
    expect(createMontage).toHaveBeenCalledWith({
      clipIds: ['clip-a', 'clip-s'],
      transition: 'cut',
      titleCard: null,
      ratio: '9:16',
    });
  });

  it('says why Create is off below two clips', () => {
    const { dialog } = open([A, B]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take Out Big Play' }));
    expect(within(dialog).getByTestId('clips-montage-create')).toBeDisabled();
    expect(within(dialog).getByTestId('clips-montage-why')).toHaveTextContent(MONTAGE_TOO_FEW);
  });

  it('says so over fifteen clips', () => {
    const many = Array.from({ length: 16 }, (_, i) =>
      fixtureClipItem({ id: `clip-${i}`, title: `Clip ${i}`, durationMs: 5_000 }),
    );
    const { dialog } = open(many);
    expect(within(dialog).getByTestId('clips-montage-why')).toHaveTextContent(
      'A montage holds up to 15 clips.',
    );
  });

  it('creates the montage in order with the title and opens the editor', async () => {
    createMontage.mockResolvedValue({ clip: fixtureClipView({ id: 'clip-m', origin: 'MONTAGE' }) });
    const { dialog, onCreated } = open([A, B]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move Team Talk Down' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fade' }));
    fireEvent.change(within(dialog).getByPlaceholderText('Enter your title'), {
      target: { value: '  Best Of   The Week ' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId('clips-montage-create'));
    });
    expect(createMontage).toHaveBeenCalledWith({
      clipIds: ['clip-b', 'clip-a'],
      transition: 'fade',
      titleCard: 'Best Of The Week',
    });
    expect(onCreated).toHaveBeenCalledWith('clip-m');
    expect(push).toHaveBeenCalledWith('/seed-demo-org/clips/edit/clip-m');
  });

  it("shows the server's sentence on a refusal", async () => {
    createMontage.mockRejectedValue(
      new ApiError(
        'A montage lasts at most 20 minutes. Take out a clip or two.',
        422,
        'montage_too_long',
      ),
    );
    const { dialog } = open([A, B]);
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId('clips-montage-create'));
    });
    expect(within(dialog).getByTestId('clips-montage-problem')).toHaveTextContent(
      'A montage lasts at most 20 minutes.',
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('asks for a shape when the server says the shapes differ', async () => {
    createMontage.mockRejectedValue(
      new ApiError(
        'These clips have different shapes. Pick one shape for the montage.',
        422,
        'montage_shapes_differ',
      ),
    );
    const { dialog } = open([A, B]);
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId('clips-montage-create'));
    });
    expect(within(dialog).getByTestId('clips-montage-shape')).toBeInTheDocument();
  });
});
