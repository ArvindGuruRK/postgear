import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { ClipSummary } from '@/types/clips';
import type { ClipActions } from '../library/clip-actions';
import { fixtureClipSummary } from '../library/clip-list-fixtures';
import { clipEditHref, clipFacts, NO_CLIPS_YET, VideoClipList } from './video-clip-list';

jest.mock('@/lib/clips-api', () => ({}));

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

const ORIGINAL = fixtureClipSummary({
  id: 'clip-a',
  title: 'PostGear Sample: A Three Minute Talk (0:30)',
  durationMs: 20_000,
});
const COPY = fixtureClipSummary({
  id: 'clip-b',
  title: 'PostGear Sample: A Three Minute Talk (0:30) (Copy)',
  durationMs: 9_000,
  ratio: '1:1',
  state: 'hidden',
  status: 'HIDDEN',
  range: null,
});

function actions(): jest.Mocked<ClipActions> {
  return {
    rename: jest.fn<Promise<void>, [ClipSummary, string]>(async () => undefined),
    duplicate: jest.fn<Promise<void>, [ClipSummary]>(async () => undefined),
    toggleHidden: jest.fn<Promise<void>, [ClipSummary]>(async () => undefined),
    remove: jest.fn<Promise<void>, [ClipSummary]>(async () => undefined),
  };
}

function renderList(
  clips: readonly ClipSummary[] = [ORIGINAL, COPY],
  selectedId: string | null = null,
) {
  const props = { actions: actions(), onSelect: jest.fn(), onPlay: jest.fn() };
  render(
    <TooltipProvider>
      <VideoClipList orgId="seed-demo-org" clips={clips} selectedId={selectedId} {...props} />
    </TooltipProvider>,
  );
  return props;
}

const rows = () => screen.getAllByTestId('video-clip-row');

describe('clipFacts and clipEditHref', () => {
  it('reads the length and the shape', () => {
    expect(clipFacts({ durationMs: 42_000, ratio: '9:16' })).toBe('0:42, 9:16');
    expect(clipFacts({ durationMs: 3_723_000, ratio: '16:9' })).toBe('1:02:03, 16:9');
  });

  it('links to the clip editor, with both ids made safe for a path', () => {
    expect(clipEditHref('seed-demo-org', 'clip-1')).toBe('/seed-demo-org/clips/edit/clip-1');
    expect(clipEditHref('a b', 'c/d')).toBe('/a%20b/clips/edit/c%2Fd');
  });
});

describe('VideoClipList', () => {
  it('says how to make one when there are none', () => {
    renderList([]);
    expect(screen.getByText(NO_CLIPS_YET)).toBeVisible();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows each clip with its whole name on its own line, its facts and its state', () => {
    renderList();
    expect(screen.getByRole('list', { name: 'Clips from this video' })).toBeInTheDocument();
    expect(rows()).toHaveLength(2);

    const [first, second] = rows();
    const name = within(second).getByRole('button', { name: COPY.title });
    // The name is a direct child of the row: it has the whole width, above the actions.
    expect(name.parentElement).toBe(second);
    expect(name).toHaveAttribute('title', COPY.title);
    expect(name.className).toContain('line-clamp-2');
    expect(name.className).not.toContain('truncate');

    expect(within(first).getByText('0:20, 9:16')).toBeVisible();
    expect(within(first).getByText('Draft')).toBeVisible();
    expect(within(second).getByText('0:09, 1:1')).toBeVisible();
    expect(within(second).getByText('Hidden')).toBeVisible();
    expect(second).toHaveAttribute('data-state', 'hidden');
    expect(second.className).toContain('border-dashed');
    expect(first.className).not.toContain('border-dashed');
  });

  it('chooses a clip from its name, and rings the one chosen', () => {
    const props = renderList([ORIGINAL, COPY], 'clip-a');
    expect(rows()[0].className).toContain('ring-2');
    expect(rows()[1].className).not.toContain('ring-2');
    fireEvent.click(screen.getByRole('button', { name: COPY.title }));
    expect(props.onSelect).toHaveBeenCalledWith(COPY);
  });

  it('plays a clip with a range, and cannot play one without', () => {
    const props = renderList();
    const play = screen.getByRole('button', { name: `Play ${ORIGINAL.title}` });
    expect(play).toBeEnabled();
    fireEvent.click(play);
    expect(props.onPlay).toHaveBeenCalledWith(ORIGINAL);
    expect(screen.getByRole('button', { name: `Play ${COPY.title}` })).toBeDisabled();
  });

  it('opens each clip in the editor', () => {
    renderList();
    const [first, second] = rows();
    expect(within(first).getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/seed-demo-org/clips/edit/clip-a',
    );
    expect(within(second).getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/seed-demo-org/clips/edit/clip-b',
    );
  });

  it('offers Unhide for a hidden clip and Hide for the others', async () => {
    const props = renderList();
    fireEvent.keyDown(screen.getByRole('button', { name: `More for ${COPY.title}` }), {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Unhide' }));
    expect(props.actions.toggleHidden).toHaveBeenCalledWith(COPY);

    fireEvent.keyDown(screen.getByRole('button', { name: `More for ${ORIGINAL.title}` }), {
      key: 'Enter',
    });
    expect(await screen.findByRole('menuitem', { name: 'Hide' })).toBeInTheDocument();
  });
});

describe('AI picks (Module 16)', () => {
  const pick = (id: string, score: number, reasons: string[]) =>
    fixtureClipSummary({
      id,
      title: `Stream Sample ${id}`,
      origin: 'AI_SIGNALS',
      status: 'NEW',
      state: 'new',
      score,
      reasons,
    });

  it('lists AI picks best first with score and reasons, then the hand-made clips under their group', () => {
    renderList([
      ORIGINAL,
      pick('low', 55, ['fast_cuts']),
      pick('top', 91.6, ['chat_burst', 'loud', 'louder', 'replayed']),
    ]);
    const aiList = screen.getByRole('list', { name: 'Clips found by AI' });
    const aiRows = within(aiList).getAllByTestId('video-clip-row');
    expect(aiRows.map((row) => row.getAttribute('data-origin'))).toEqual([
      'AI_SIGNALS',
      'AI_SIGNALS',
    ]);
    expect(within(aiRows[0] as HTMLElement).getByTestId('video-clip-score')).toHaveTextContent(
      '92',
    );
    expect(within(aiRows[0] as HTMLElement).getByTestId('video-clip-reasons')).toHaveTextContent(
      'Chat exploded, Loud reaction, Louder than usual',
    );
    expect(within(aiRows[1] as HTMLElement).getByTestId('video-clip-score')).toHaveTextContent(
      '55',
    );

    const hand = screen.getByRole('list', { name: 'Made By Hand' });
    expect(within(hand).getAllByTestId('video-clip-row')).toHaveLength(1);
    expect(within(hand).queryByTestId('video-clip-score')).toBeNull();
  });

  it('hides a poor pick from its menu', async () => {
    const top = pick('top', 90, ['loud']);
    const props = renderList([top]);
    fireEvent.keyDown(screen.getByRole('button', { name: `More for ${top.title}` }), {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Hide' }));
    expect(props.actions.toggleHidden).toHaveBeenCalledWith(top);
  });
});
