import { isTyping, VIDEO_SHORTCUTS, videoShortcutFor } from './video-shortcuts';

describe('videoShortcutFor', () => {
  it('plays, pauses and jumps with Space, J, K and L', () => {
    expect(videoShortcutFor({ key: ' ' })).toBe('togglePlay');
    expect(videoShortcutFor({ key: 'Spacebar' })).toBe('togglePlay');
    expect(videoShortcutFor({ key: 'j' })).toBe('back');
    expect(videoShortcutFor({ key: 'k' })).toBe('pause');
    expect(videoShortcutFor({ key: 'l' })).toBe('forward');
  });

  it('marks with I and O, whatever the case', () => {
    expect(videoShortcutFor({ key: 'i' })).toBe('markIn');
    expect(videoShortcutFor({ key: 'I', shiftKey: true })).toBe('markIn');
    expect(videoShortcutFor({ key: 'o' })).toBe('markOut');
    expect(videoShortcutFor({ key: 'O' })).toBe('markOut');
  });

  it('steps one second with the arrows and five with Shift', () => {
    expect(videoShortcutFor({ key: 'ArrowLeft' })).toBe('stepBack');
    expect(videoShortcutFor({ key: 'ArrowRight' })).toBe('stepForward');
    expect(videoShortcutFor({ key: 'ArrowLeft', shiftKey: true })).toBe('stepBackLarge');
    expect(videoShortcutFor({ key: 'ArrowRight', shiftKey: true })).toBe('stepForwardLarge');
  });

  it('creates the clip with Enter, but not Shift and Enter', () => {
    expect(videoShortcutFor({ key: 'Enter' })).toBe('createClip');
    expect(videoShortcutFor({ key: 'Enter', shiftKey: true })).toBeNull();
  });

  it('zooms with + and -, and the keys that share them', () => {
    expect(videoShortcutFor({ key: '+' })).toBe('zoomIn');
    expect(videoShortcutFor({ key: '=' })).toBe('zoomIn');
    expect(videoShortcutFor({ key: '-' })).toBe('zoomOut');
    expect(videoShortcutFor({ key: '_' })).toBe('zoomOut');
  });

  it('leaves Ctrl, Cmd and Alt presses to the browser', () => {
    expect(videoShortcutFor({ key: 'i', ctrlKey: true })).toBeNull();
    expect(videoShortcutFor({ key: ' ', metaKey: true })).toBeNull();
    expect(videoShortcutFor({ key: 'ArrowLeft', altKey: true })).toBeNull();
    expect(videoShortcutFor({ key: '+', ctrlKey: true })).toBeNull();
  });

  it('answers null for any other key', () => {
    for (const key of ['a', 'Escape', 'Tab', 'ArrowUp', 'Delete', '1']) {
      expect(videoShortcutFor({ key })).toBeNull();
    }
  });

  it('lists every key on the sheet, each with a sentence-case label', () => {
    expect(VIDEO_SHORTCUTS.map((entry) => entry.keys[0])).toEqual([
      'Space',
      'J',
      'K',
      'L',
      'Left',
      'Right',
      'I',
      'O',
      'Enter',
      '+',
      '-',
    ]);
    for (const { label } of VIDEO_SHORTCUTS) {
      expect(label[0]).toBe(label[0]?.toUpperCase());
    }
  });
});

describe('isTyping', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is true in a field, a text area, a select or editable text', () => {
    document.body.innerHTML = `
      <input id="a" />
      <textarea id="b"></textarea>
      <select id="c"><option>x</option></select>
      <div contenteditable="true"><span id="d">x</span></div>`;
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(isTyping(document.getElementById(id))).toBe(true);
    }
  });

  it('is true inside a dialog, a menu or a list box', () => {
    document.body.innerHTML = `
      <div role="dialog"><button id="a">x</button></div>
      <div role="alertdialog"><button id="b">x</button></div>
      <div role="menu"><div id="c">x</div></div>
      <div role="listbox"><div id="d">x</div></div>`;
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(isTyping(document.getElementById(id))).toBe(true);
    }
  });

  it('is false on the page itself, on a button, and with no target', () => {
    document.body.innerHTML = '<main><button id="a">Play</button></main>';
    expect(isTyping(document.getElementById('a'))).toBe(false);
    expect(isTyping(document.body)).toBe(false);
    expect(isTyping(null)).toBe(false);
    expect(isTyping(window)).toBe(false);
  });
});
