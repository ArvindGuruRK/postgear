import { TooltipProvider } from '@postgear/ui';
import { render, screen, within } from '@testing-library/react';
import {
  CLIP_SHORTCUT_GROUPS,
  CONTROL_OWNED,
  type ClipShortcutPress,
  clipShortcutFor,
  keyCaps,
  nudgeFor,
} from './editor-shortcuts';
import { EditorShortcutsSheet } from './editor-shortcuts-sheet';

function press(key: string, mods: Partial<Omit<ClipShortcutPress, 'key'>> = {}): ClipShortcutPress {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods };
}

describe('clipShortcutFor', () => {
  it.each([
    [press(' '), 'toggle'],
    [press('ArrowLeft'), 'frameBack'],
    [press('ArrowRight'), 'frameForward'],
    [press('ArrowLeft', { shiftKey: true }), 'secondBack'],
    [press('ArrowRight', { shiftKey: true }), 'secondForward'],
    [press('Home'), 'start'],
    [press('End'), 'end'],
    [press('s'), 'split'],
    [press('S'), 'split'],
    [press('Delete'), 'delete'],
    [press('Backspace'), 'delete'],
    [press('d', { ctrlKey: true }), 'duplicate'],
    [press('d', { metaKey: true }), 'duplicate'],
    [press('+', { shiftKey: true }), 'zoomIn'],
    [press('='), 'zoomIn'],
    [press('-'), 'zoomOut'],
    [press('Z', { shiftKey: true }), 'fit'],
    [press('Escape'), 'escape'],
    [press('Enter'), 'edit'],
    [press('?', { shiftKey: true }), 'shortcuts'],
  ] as const)('reads %o as %s', (keys, command) => {
    expect(clipShortcutFor(keys)).toBe(command);
  });

  it.each([
    press('s', { altKey: true }),
    press('ArrowLeft', { altKey: true }),
    press('z', { ctrlKey: true }),
    press('d', { ctrlKey: true, shiftKey: true }),
    press('S', { shiftKey: true }),
    press(' ', { shiftKey: true }),
    press('Home', { shiftKey: true }),
    press('x'),
    press('Enter', { ctrlKey: true }),
  ])('leaves %o alone', (keys) => {
    expect(clipShortcutFor(keys)).toBeNull();
  });

  it('leaves the playback keys to a focused control, and nothing else', () => {
    expect([...CONTROL_OWNED].sort()).toEqual(
      [
        'edit',
        'end',
        'frameBack',
        'frameForward',
        'secondBack',
        'secondForward',
        'start',
        'toggle',
      ].sort(),
    );
  });
});

describe('nudgeFor', () => {
  it('reads the arrows as a nudge of a pixel, or ten with Shift', () => {
    expect(nudgeFor(press('ArrowLeft'))).toEqual({ x: -1, y: 0, big: false });
    expect(nudgeFor(press('ArrowRight'))).toEqual({ x: 1, y: 0, big: false });
    expect(nudgeFor(press('ArrowUp', { shiftKey: true }))).toEqual({ x: 0, y: -1, big: true });
    expect(nudgeFor(press('ArrowDown'))).toEqual({ x: 0, y: 1, big: false });
  });

  it('leaves other keys and the arrows with Ctrl, Cmd or Alt alone', () => {
    expect(nudgeFor(press('s'))).toBeNull();
    expect(nudgeFor(press('ArrowLeft', { ctrlKey: true }))).toBeNull();
    expect(nudgeFor(press('ArrowLeft', { metaKey: true }))).toBeNull();
    expect(nudgeFor(press('ArrowLeft', { altKey: true }))).toBeNull();
  });
});

describe('keyCaps', () => {
  it('splits a combination into caps, and keeps a lone plus', () => {
    expect(keyCaps('Ctrl+Shift+Z')).toEqual(['Ctrl', 'Shift', 'Z']);
    expect(keyCaps('+')).toEqual(['+']);
    expect(keyCaps('S')).toEqual(['S']);
  });
});

describe('EditorShortcutsSheet', () => {
  it('lists every row of the table under its group', () => {
    render(
      <TooltipProvider>
        <EditorShortcutsSheet open onOpenChange={() => undefined} />
      </TooltipProvider>,
    );
    const sheet = screen.getByTestId('clip-shortcuts-sheet');
    for (const group of CLIP_SHORTCUT_GROUPS) {
      const section = within(sheet).getByRole('region', { name: group.name });
      for (const row of group.rows) {
        expect(within(section).getByText(row.label)).toBeInTheDocument();
      }
    }
    expect(
      within(sheet)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Playback', 'Editing', 'Timeline']);
  });

  it('has a row for every key the editor answers', () => {
    const listed = CLIP_SHORTCUT_GROUPS.flatMap((group) => group.rows).map((row) => row.label);
    expect(listed).toEqual(
      expect.arrayContaining([
        'Play or pause',
        'Split at the playhead',
        'Remove the selected part, item or zoom',
        'Duplicate the selected item',
        'Zoom the timeline in or out',
        'Fit the whole clip in the timeline',
        'Clear the selection',
        'Type into the selected text',
        'Move the selected text a pixel (Shift: ten)',
        'Move the selected bar a frame (Shift: a second)',
        'Show these shortcuts',
      ]),
    );
  });
});
