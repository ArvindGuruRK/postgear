import { isTyping, shortcutFor } from './builder-shortcuts';

describe('builder shortcuts', () => {
  it('maps the blueprint keys', () => {
    expect(shortcutFor({ key: 'n' })).toBe('openPicker');
    expect(shortcutFor({ key: 'S', shiftKey: true })).toBe('addNote');
    expect(shortcutFor({ key: 'F2' })).toBe('rename');
    expect(shortcutFor({ key: 'd' })).toBe('toggleDisabled');
    expect(shortcutFor({ key: 'd', ctrlKey: true })).toBe('duplicate');
    expect(shortcutFor({ key: 'z', metaKey: true })).toBe('undo');
    expect(shortcutFor({ key: 'Z', ctrlKey: true, shiftKey: true })).toBe('redo');
    expect(shortcutFor({ key: 'k', ctrlKey: true })).toBe('palette');
    expect(shortcutFor({ key: 'Backspace' })).toBe('delete');
    expect(shortcutFor({ key: '?', shiftKey: true })).toBe('shortcuts');
    expect(shortcutFor({ key: '1' })).toBe('fit');
    expect(shortcutFor({ key: 'ArrowRight' })).toBe('next');
  });

  it('ignores other keys and Alt combinations', () => {
    expect(shortcutFor({ key: 'q' })).toBeNull();
    expect(shortcutFor({ key: 'n', altKey: true })).toBeNull();
    expect(shortcutFor({ key: 'x', ctrlKey: true })).toBeNull();
    expect(shortcutFor({ key: 'N', shiftKey: true })).toBeNull();
  });

  it('never fires while typing in a field, a dialog or a menu', () => {
    document.body.innerHTML = `
      <input id="field" />
      <div role="dialog"><button id="in-dialog">x</button></div>
      <div role="menu"><div id="in-menu" tabindex="0">x</div></div>
      <div id="canvas" tabindex="0"></div>`;
    expect(isTyping(document.getElementById('field'))).toBe(true);
    expect(isTyping(document.getElementById('in-dialog'))).toBe(true);
    expect(isTyping(document.getElementById('in-menu'))).toBe(true);
    expect(isTyping(document.getElementById('canvas'))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});
