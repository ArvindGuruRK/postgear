import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError } from '@/lib/api';
import type { ClipListItem, ClipPoster, ClipSummary } from '@/types/clips';
import {
  type ClipActions,
  ClipMenu,
  clipActions,
  clipErrorSentence,
  DELETE_CLIP_SENTENCE,
  RenameField,
} from './clip-actions';
import { ClipCard, ClipPosterBox, posterLayout, ratioValue } from './clip-card';
import { fixtureClipItem, fixtureClipSummary, fixtureClipView } from './clip-list-fixtures';

jest.mock('@/lib/clips-api', () => ({
  updateClip: jest.fn(),
  duplicateClip: jest.fn(),
  deleteClip: jest.fn(),
}));
const toast = jest.fn();
jest.mock('@postgear/ui', () => ({
  ...jest.requireActual('@postgear/ui'),
  toast: (input: unknown) => toast(input),
}));

const api = jest.requireMock('@/lib/clips-api') as {
  updateClip: jest.Mock;
  duplicateClip: jest.Mock;
  deleteClip: jest.Mock;
};

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
  // jsdom has no PointerEvent, so fireEvent would drop pointerType.
  if (!('PointerEvent' in window)) {
    class PointerEventStub extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? '';
      }
    }
    Object.defineProperty(window, 'PointerEvent', { configurable: true, value: PointerEventStub });
  }
});

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  toast.mockClear();
});

function mockedActions(): jest.Mocked<ClipActions> {
  return {
    rename: jest.fn<Promise<void>, [ClipSummary, string]>(async () => undefined),
    duplicate: jest.fn<Promise<void>, [ClipSummary]>(async () => undefined),
    toggleHidden: jest.fn<Promise<void>, [ClipSummary]>(async () => undefined),
    remove: jest.fn<Promise<void>, [ClipSummary]>(async () => undefined),
  };
}

const POSTER: ClipPoster = {
  url: 'http://localhost:3001/clips/files/sheet',
  x: 320,
  y: 180,
  width: 160,
  height: 90,
  sheetWidth: 1600,
  sheetHeight: 900,
};

function openMenu(title: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: `More for ${title}` }), { key: 'Enter' });
}

describe('ratioValue and posterLayout', () => {
  it('reads a shape, and takes 9:16 for anything it cannot read', () => {
    expect(ratioValue('16:9')).toBeCloseTo(16 / 9);
    expect(ratioValue('1:1')).toBe(1);
    expect(ratioValue('9:16')).toBeCloseTo(0.5625);
    for (const bad of ['', 'wide', '0:9', '9:0', '-1:2', 'NaN:3']) {
      expect(ratioValue(bad)).toBeCloseTo(9 / 16);
    }
  });

  it('covers a tall box with a wide tile: as tall as the box, wider than it', () => {
    const { frame, image } = posterLayout(POSTER, 9 / 16);
    expect(frame.height).toBe('100%');
    expect(Number.parseFloat(frame.width ?? '')).toBeCloseTo((16 / 9 / (9 / 16)) * 100);
    // The sheet is ten tiles wide, and this tile is the third across, the third down.
    expect(image).toEqual({ width: '1000%', height: '1000%', left: '-200%', top: '-200%' });
  });

  it('covers a wide box with a tall tile: as wide as the box', () => {
    const tall = { ...POSTER, width: 90, height: 160 };
    const { frame } = posterLayout(tall, 16 / 9);
    expect(frame.width).toBe('100%');
    expect(Number.parseFloat(frame.height ?? '')).toBeCloseTo((16 / 9 / (9 / 16)) * 100);
  });
});

describe('ClipPosterBox', () => {
  it('cuts the tile out of its sheet, and falls back to a plain mark when it fails', () => {
    const { container } = render(
      <ClipPosterBox clip={{ ratio: '9:16', poster: POSTER, preview: null }} previewing={false} />,
    );
    const image = container.querySelector('img') as HTMLImageElement;
    expect(image).toHaveAttribute('src', POSTER.url);
    expect(image).toHaveAttribute('alt', '');
    fireEvent.error(image);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('plays the preview silently only while asked and only while its address works', () => {
    const preview = {
      url: 'http://localhost:3001/clips/files/light',
      fromMs: 30_000,
      toMs: 72_000,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    const clip = { ratio: '9:16', poster: null, preview };
    const { container, rerender } = render(<ClipPosterBox clip={clip} previewing={false} />);
    expect(container.querySelector('video')).toBeNull();

    rerender(<ClipPosterBox clip={clip} previewing />);
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video).toHaveAttribute('src', preview.url);
    expect(video.muted).toBe(true);

    const expired = { ...preview, expiresAt: new Date(Date.now() - 1_000).toISOString() };
    rerender(<ClipPosterBox clip={{ ...clip, preview: expired }} previewing />);
    expect(container.querySelector('video')).toBeNull();

    const empty = { ...preview, toMs: preview.fromMs };
    rerender(<ClipPosterBox clip={{ ...clip, preview: empty }} previewing />);
    expect(container.querySelector('video')).toBeNull();
  });
});

describe('ClipCard', () => {
  function renderCard(clip: ClipListItem = fixtureClipItem(), actions = mockedActions()) {
    render(
      <TooltipProvider>
        <ul>
          <ClipCard clip={clip} orgId="seed-demo-org" actions={actions} />
        </ul>
      </TooltipProvider>,
    );
    return actions;
  }

  it('shows the name, the facts, the state, the video it came from and Edit', () => {
    renderCard();
    const card = screen.getByTestId('clip-card');
    expect(card).toHaveAttribute('data-state', 'draft');
    expect(within(card).getByText('Team Talk (0:30)')).toHaveAttribute('title', 'Team Talk (0:30)');
    expect(within(card).getByText('0:42, 9:16')).toBeVisible();
    expect(within(card).getByText('Draft')).toBeVisible();
    expect(
      within(card).getByText('YouTube, PostGear Sample: A Three Minute Talk'),
    ).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/seed-demo-org/clips/edit/clip-1',
    );
    expect(card.className).not.toContain('border-dashed');
  });

  it('draws a hidden clip with a dashed edge', () => {
    renderCard(fixtureClipItem({ state: 'hidden', status: 'HIDDEN', platform: 'twitch' }));
    const card = screen.getByTestId('clip-card');
    expect(card.className).toContain('border-dashed');
    expect(within(card).getByText('Hidden')).toBeVisible();
    expect(within(card).getByText(/^Twitch, /)).toBeInTheDocument();
  });

  it('previews on a mouse hover only, and stops when the pointer leaves', () => {
    const preview = {
      url: 'http://localhost:3001/clips/files/light',
      fromMs: 0,
      toMs: 5_000,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    renderCard(fixtureClipItem({ preview }));
    const card = screen.getByTestId('clip-card');
    fireEvent.pointerEnter(card, { pointerType: 'touch' });
    expect(card.querySelector('video')).toBeNull();
    fireEvent.pointerEnter(card, { pointerType: 'mouse' });
    expect(card.querySelector('video')).not.toBeNull();
    fireEvent.pointerLeave(card);
    expect(card.querySelector('video')).toBeNull();
  });

  // Choosing Rename mounts the name field and focuses it; the closing menu
  // must not hand focus back to its own button (found 2026-11-18: the field
  // sat there unfocused in Chrome, and blurred and closed in jsdom).
  it('keeps the name field open and focused after Rename is chosen from the menu', async () => {
    const actions = renderCard();
    openMenu('Team Talk (0:30)');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByRole('textbox', { name: 'Clip name' })).toHaveFocus();
    expect(actions.rename).not.toHaveBeenCalled();
  });

  it('duplicates and hides from the menu', async () => {
    const actions = renderCard();
    const clip = fixtureClipItem();
    openMenu(clip.title);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    expect(actions.duplicate).toHaveBeenCalledWith(clip);
    openMenu(clip.title);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Hide' }));
    expect(actions.toggleHidden).toHaveBeenCalledWith(clip);
  });
});

describe('ClipMenu: Delete Clip', () => {
  function renderMenu(actions: ClipActions) {
    const clip = fixtureClipSummary();
    render(
      <TooltipProvider>
        <ClipMenu clip={clip} actions={actions} onStartRename={jest.fn()} />
      </TooltipProvider>,
    );
    return clip;
  }

  it('asks first, in red, and Cancel deletes nothing', async () => {
    const actions = mockedActions();
    const clip = renderMenu(actions);
    openMenu(clip.title);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete Clip' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Clip' });
    expect(within(confirm).getByText(DELETE_CLIP_SENTENCE)).toBeVisible();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(actions.remove).not.toHaveBeenCalled();
  });

  it('says Deleting while it runs, keeps the confirm open until done, then closes', async () => {
    let finish: () => void = () => undefined;
    const actions = mockedActions();
    actions.remove.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const clip = renderMenu(actions);
    openMenu(clip.title);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete Clip' }));
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete Clip' }));

    expect(actions.remove).toHaveBeenCalledWith(clip);
    expect(within(confirm).getByRole('button', { name: 'Deleting' })).toBeDisabled();
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(confirm, { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    await act(async () => finish());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
});

describe('RenameField', () => {
  function renderField(onSave = jest.fn(async () => undefined)) {
    const onDone = jest.fn();
    render(<RenameField title="Team Talk" onSave={onSave} onDone={onDone} />);
    return { onSave, onDone, field: screen.getByRole('textbox', { name: 'Clip name' }) };
  }

  it('starts focused with the name selected, and says what to enter', () => {
    const { field } = renderField();
    expect(field).toHaveFocus();
    expect(field).toHaveValue('Team Talk');
    expect(field).toHaveAttribute('placeholder', 'Enter your clip name');
    expect(field).toHaveAttribute('maxLength', '200');
  });

  it('saves once on Enter, even when the field then loses focus', async () => {
    const { onSave, onDone, field } = renderField();
    fireEvent.change(field, { target: { value: 'Best Bit' } });
    await act(async () => {
      fireEvent.submit(field.closest('form') as HTMLFormElement);
    });
    fireEvent.blur(field);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('Best Bit');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('saves when it loses focus', async () => {
    const { onSave, onDone, field } = renderField();
    fireEvent.change(field, { target: { value: 'Left Behind' } });
    await act(async () => {
      fireEvent.blur(field);
    });
    expect(onSave).toHaveBeenCalledWith('Left Behind');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('puts the name back on Escape without saving, also when it then loses focus', () => {
    const { onSave, onDone, field } = renderField();
    fireEvent.change(field, { target: { value: 'Never Kept' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    fireEvent.blur(field);
    expect(onSave).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('clipActions', () => {
  function wired() {
    const hooks = {
      onChanged: jest.fn(),
      onAdded: jest.fn(),
      onRemoved: jest.fn(),
      onStale: jest.fn(),
    };
    return { hooks, actions: clipActions(hooks) };
  }
  const clip = fixtureClipSummary();

  it('renames with the clip revision, cleaning the name, and skips an empty or same one', async () => {
    const { hooks, actions } = wired();
    const answer = fixtureClipView({ title: 'Best Bit' });
    api.updateClip.mockResolvedValue(answer);
    await actions.rename(clip, '   Best    Bit  ');
    expect(api.updateClip).toHaveBeenCalledWith('clip-1', 3, { title: 'Best Bit' });
    expect(hooks.onChanged).toHaveBeenCalledWith(answer);

    await actions.rename(clip, '    ');
    await actions.rename(clip, ` ${clip.title} `);
    expect(api.updateClip).toHaveBeenCalledTimes(1);
  });

  it('cuts a long name to 200 characters', async () => {
    const { actions } = wired();
    api.updateClip.mockResolvedValue(fixtureClipView());
    await actions.rename(clip, 'x'.repeat(250));
    expect(api.updateClip.mock.calls[0][2].title).toHaveLength(200);
  });

  it('duplicates, hands over the copy with the clip it came from, and says so', async () => {
    const { hooks, actions } = wired();
    const copy = fixtureClipView({ id: 'clip-2', title: 'Team Talk (0:30) (Copy)' });
    api.duplicateClip.mockResolvedValue(copy);
    await actions.duplicate(clip);
    expect(api.duplicateClip).toHaveBeenCalledWith('clip-1');
    expect(hooks.onAdded).toHaveBeenCalledWith(copy, clip);
    expect(toast).toHaveBeenCalledWith({ title: 'Clip duplicated.' });
  });

  it('hides a shown clip and shows a hidden one again', async () => {
    const { actions } = wired();
    api.updateClip.mockResolvedValue(fixtureClipView());
    await actions.toggleHidden(clip);
    expect(api.updateClip).toHaveBeenLastCalledWith('clip-1', 3, { status: 'HIDDEN' });
    expect(toast).toHaveBeenLastCalledWith({ title: 'Clip hidden.' });

    await actions.toggleHidden({ ...clip, state: 'hidden', status: 'HIDDEN' });
    expect(api.updateClip).toHaveBeenLastCalledWith('clip-1', 3, { status: 'DRAFT' });
    expect(toast).toHaveBeenLastCalledWith({ title: 'Clip shown again.' });
  });

  it("deletes, takes the clip off, and toasts the API's own sentence", async () => {
    const { hooks, actions } = wired();
    api.deleteClip.mockResolvedValue({ message: 'Clip deleted.' });
    await actions.remove(clip);
    expect(api.deleteClip).toHaveBeenCalledWith('clip-1');
    expect(hooks.onRemoved).toHaveBeenCalledWith('clip-1');
    expect(toast).toHaveBeenCalledWith({ title: 'Clip deleted.' });
  });

  it('reads the list again after someone else changed or deleted the clip', async () => {
    const { hooks, actions } = wired();
    api.updateClip.mockRejectedValueOnce(new ApiError('Someone changed this clip.', 409));
    await actions.rename(clip, 'New Name');
    expect(toast).toHaveBeenLastCalledWith({
      title: 'Someone changed this clip.',
      variant: 'danger',
    });
    expect(hooks.onStale).toHaveBeenCalledTimes(1);

    api.deleteClip.mockRejectedValueOnce(new ApiError('That clip is gone.', 404));
    await actions.remove(clip);
    expect(hooks.onStale).toHaveBeenCalledTimes(2);
    expect(hooks.onRemoved).not.toHaveBeenCalled();
  });

  it('says to check the connection when the call never arrived, and keeps the list', async () => {
    const { hooks, actions } = wired();
    api.duplicateClip.mockRejectedValueOnce(new ApiError('offline', 0));
    await actions.duplicate(clip);
    const sentence = 'That did not go through. Check your connection and try again.';
    expect(toast).toHaveBeenLastCalledWith({ title: sentence, variant: 'danger' });
    expect(hooks.onStale).not.toHaveBeenCalled();
    expect(clipErrorSentence(new TypeError('Failed to fetch'))).toBe(sentence);
    expect(clipErrorSentence(new ApiError('Not allowed.', 403))).toBe('Not allowed.');
  });
});
