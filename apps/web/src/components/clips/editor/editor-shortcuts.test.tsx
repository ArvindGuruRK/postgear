import { TooltipProvider } from '@postgear/ui';
import { render, screen, within } from '@testing-library/react';
import {
  CLIP_SHORTCUT_GROUPS,
  CONTROL_OWNED,
  type ClipShortcutPress,
  clipShortcutFor,
  keyCaps,
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
    press('Enter'),
  ])('leaves %o alone', (keys) => {
    expect(clipShortcutFor(keys)).toBeNull();
  });

  it('leaves the playback keys to a focused control, and nothing else', () => {
    expect([...CONTROL_OWNED].sort()).toEqual(
      ['end', 'frameBack', 'frameForward', 'secondBack', 'secondForward', 'start', 'toggle'].sort(),
    );
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
        'Remove the selected part or item',
        'Duplicate the selected item',
        'Zoom the timeline in or out',
        'Fit the whole clip in the timeline',
        'Clear the selection',
        'Show these shortcuts',
      ]),
    );
  });
});
