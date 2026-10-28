import {
  addSlide,
  type DesignBrand,
  type DesignDocument,
  documentFromPreset,
  latestLayout,
  layoutKey,
  SAFE_PHOTO_OVERLAY,
  type SlotId,
  setBackground,
} from '@postgear/design-engine';
import { ApiError } from '@/lib/api';
import type { MediaItem } from '@/types/media';
import type { BrandKitView, StudioMediaRef } from '@/types/studio';
import {
  backFromComposer,
  DESIGN_MISSING_MESSAGE,
  editorShortcut,
  focusFirstIn,
  isApplePlatform,
  type KeyPlace,
  keyPlaceOf,
  kitLogoOf,
  LATEST_FAILED_MESSAGE,
  type LinkPress,
  latestProblem,
  leaveHref,
  linkOf,
  loadFailureOf,
  mediaRefOf,
  mergeMedia,
  NO_OVERFLOW,
  openerOf,
  type PressedLink,
  pickedMediaId,
  pickerCopy,
  placeOf,
  returnFocus,
  type ShortcutPress,
  settleWithin,
  shortcutOf,
  withKitLogo,
  withMediaRef,
  withOverflow,
  withPickedMedia,
} from './studio-editor-model';

const BRAND: DesignBrand = {
  kitId: null,
  colors: null,
  logoMediaId: 'brand-logo',
  name: null,
  kitVersion: null,
};

/**
 * Tips Steps (Ink), portrait, with the brand logo set: s1 to s5 from the
 * preset, then a Split Picture slide (s6), which has an image slot and the
 * frame's logo.
 */
function design(): DesignDocument {
  let next = 0;
  const base = documentFromPreset({
    presetId: 'tips-steps-ink',
    format: 'portrait',
    brand: BRAND,
    newId: () => `s${++next}`,
  });

  const split = latestLayout('split-picture');
  if (!split) throw new Error('The Split Picture layout is missing.');
  return addSlide(base, { layoutId: layoutKey(split), newId: () => 's6' });
}

const LOGO_URL = 'http://localhost:3001/uploads/lotus-logo.png';

function kit(overrides: Partial<BrandKitView> = {}): BrandKitView {
  return {
    id: 'kit-1',
    name: 'Lotus Flow Yoga',
    description: null,
    websiteUrl: null,
    logoMediaId: 'media-logo-1',
    logoUrl: LOGO_URL,
    colors: {
      primary: '#0F766E',
      secondary: '#115E59',
      accent: '#F97316',
      background: '#FFFFFF',
      text: '#0A0A0A',
    },
    source: 'MANUAL',
    createdAt: '2026-10-27T10:00:00.000Z',
    updatedAt: '2026-10-27T10:00:00.000Z',
    ...overrides,
  };
}

const ITEM: MediaItem = {
  id: 'media-1',
  name: 'Beach.jpg',
  type: 'image',
  mimeType: 'image/jpeg',
  fileSize: 1024,
  width: 1200,
  height: 800,
  url: 'http://localhost:3001/uploads/beach.jpg',
  thumbnailUrl: 'http://localhost:3001/uploads/beach-thumb.jpg',
  createdAt: '2026-10-27T10:00:00.000Z',
};

const BEACH: StudioMediaRef = {
  url: ITEM.url,
  thumbnailUrl: ITEM.thumbnailUrl,
  name: 'Beach.jpg',
  width: 1200,
  height: 800,
};

const FOREST: StudioMediaRef = {
  url: 'http://localhost:3001/uploads/forest.jpg',
  thumbnailUrl: null,
  name: 'Forest.jpg',
  width: null,
  height: null,
};

afterEach(() => {
  document.body.innerHTML = '';
  jest.useRealTimers();
});

describe('editorShortcut', () => {
  const key = (overrides: Partial<ShortcutPress> = {}): ShortcutPress => ({
    key: 'z',
    code: 'KeyZ',
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    isComposing: false,
    ...overrides,
  });
  const free: KeyPlace = { typing: false, sheltered: false, dialogOpen: false };

  it('undoes with Ctrl or Cmd + Z', () => {
    expect(editorShortcut(key(), free)).toBe('undo');
    expect(editorShortcut(key({ ctrlKey: false, metaKey: true }), free)).toBe('undo');
  });

  it('redoes with Shift + Ctrl or Cmd + Z, and with Ctrl + Y', () => {
    expect(editorShortcut(key({ key: 'Z', shiftKey: true }), free)).toBe('redo');
    expect(
      editorShortcut(key({ key: 'Z', shiftKey: true, ctrlKey: false, metaKey: true }), free),
    ).toBe('redo');
    expect(editorShortcut(key({ key: 'y', code: 'KeyY' }), free)).toBe('redo');
  });

  it('takes no other combination', () => {
    expect(editorShortcut(key({ ctrlKey: false }), free)).toBeNull();
    expect(editorShortcut(key({ key: 'x', code: 'KeyX' }), free)).toBeNull();
    // Cmd + Y is not Redo on a Mac, and Ctrl + Alt is AltGr, which types.
    expect(
      editorShortcut(key({ key: 'y', code: 'KeyY', ctrlKey: false, metaKey: true }), free),
    ).toBeNull();
    expect(editorShortcut(key({ key: 'Y', code: 'KeyY', shiftKey: true }), free)).toBeNull();
    expect(editorShortcut(key({ altKey: true }), free)).toBeNull();
  });

  it('finds the letter by its place on a keyboard without Latin letters only', () => {
    expect(editorShortcut(key({ key: 'я', code: 'KeyZ' }), free)).toBe('undo');
    expect(editorShortcut(key({ key: 'н', code: 'KeyY' }), free)).toBe('redo');
    // Dvorak keeps its own letters: the key in Z's place types a semicolon,
    // and Z sits where a US keyboard has the slash.
    expect(editorShortcut(key({ key: ';', code: 'KeyZ' }), free)).toBeNull();
    expect(editorShortcut(key({ key: 'z', code: 'Slash' }), free)).toBe('undo');
  });

  it('leaves the key alone where something else owns it', () => {
    expect(editorShortcut(key({ defaultPrevented: true }), free)).toBeNull();
    expect(editorShortcut(key({ isComposing: true }), free)).toBeNull();
    expect(editorShortcut(key(), { ...free, typing: true })).toBeNull();
    expect(editorShortcut(key(), { ...free, sheltered: true })).toBeNull();
    expect(editorShortcut(key(), { ...free, dialogOpen: true })).toBeNull();
  });

  it('names the combination wherever it was pressed (shortcutOf)', () => {
    expect(shortcutOf(key({ defaultPrevented: true }))).toBe('undo');
    expect(shortcutOf(key({ key: 'a', code: 'KeyA' }))).toBeNull();
  });
});

describe('keyPlaceOf', () => {
  function render(): void {
    document.body.innerHTML = `
      <input id="field" />
      <textarea id="area"></textarea>
      <select id="choice"><option>One</option></select>
      <div contenteditable="plaintext-only" role="textbox"><span id="typed">Hello</span></div>
      <div contenteditable="false"><button id="frozen" type="button">Slide</button></div>
      <div data-native-undo=""><button id="title" type="button">Title</button></div>
      <div role="dialog" data-state="closed"><button id="in-dialog" type="button">Close</button></div>
      <button id="canvas" type="button">Slide</button>
    `;
  }

  const at = (id: string) => document.getElementById(id);

  it('sees typing in fields and on the canvas', () => {
    render();
    expect(keyPlaceOf(at('field'), document).typing).toBe(true);
    expect(keyPlaceOf(at('area'), document).typing).toBe(true);
    expect(keyPlaceOf(at('choice'), document).typing).toBe(true);
    expect(keyPlaceOf(at('typed'), document).typing).toBe(true);
    expect(keyPlaceOf(at('typed')?.firstChild ?? null, document).typing).toBe(true);
    expect(keyPlaceOf(at('frozen'), document).typing).toBe(false);
  });

  it('sees boxes with an undo of their own, and open dialogs', () => {
    render();
    expect(keyPlaceOf(at('title'), document)).toEqual({
      typing: false,
      sheltered: true,
      dialogOpen: false,
    });
    expect(keyPlaceOf(at('in-dialog'), document).sheltered).toBe(true);
    expect(keyPlaceOf(at('canvas'), document)).toEqual({
      typing: false,
      sheltered: false,
      dialogOpen: false,
    });

    const open = document.createElement('div');
    open.setAttribute('role', 'alertdialog');
    open.setAttribute('data-state', 'open');
    document.body.append(open);
    expect(keyPlaceOf(at('canvas'), document).dialogOpen).toBe(true);
    expect(keyPlaceOf(null, document)).toEqual({
      typing: false,
      sheltered: false,
      dialogOpen: true,
    });
  });

  it("treats the editor's own drawers as the rail and the panel, not as dialogs", () => {
    document.body.innerHTML = `
      <div role="dialog" data-state="open" data-editor-drawer="">
        <button id="thumbnail" type="button">Slide 2</button>
        <input id="drawer-field" />
        <div contenteditable="plaintext-only"><span id="drawer-typed">Hello</span></div>
        <div data-native-undo=""><button id="drawer-title" type="button">Title</button></div>
      </div>
    `;
    const undo: ShortcutPress = {
      key: 'z',
      code: 'KeyZ',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      isComposing: false,
    };

    expect(keyPlaceOf(at('thumbnail'), document)).toEqual({
      typing: false,
      sheltered: false,
      dialogOpen: false,
    });
    expect(editorShortcut(undo, keyPlaceOf(at('thumbnail'), document))).toBe('undo');

    // Fields, typing and boxes with an undo of their own keep it, in a drawer too.
    expect(editorShortcut(undo, keyPlaceOf(at('drawer-field'), document))).toBeNull();
    expect(editorShortcut(undo, keyPlaceOf(at('drawer-typed'), document))).toBeNull();
    expect(editorShortcut(undo, keyPlaceOf(at('drawer-title'), document))).toBeNull();

    // Any other dialog in front of the drawer still takes the key.
    const popover = document.createElement('div');
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('data-state', 'open');
    popover.innerHTML = '<button id="in-popover" type="button">Colour</button>';
    document.body.append(popover);
    expect(keyPlaceOf(at('thumbnail'), document).dialogOpen).toBe(true);
    expect(keyPlaceOf(at('in-popover'), document).sheltered).toBe(true);
    expect(editorShortcut(undo, keyPlaceOf(at('thumbnail'), document))).toBeNull();

    popover.remove();
    const confirm = document.createElement('div');
    confirm.setAttribute('role', 'alertdialog');
    confirm.setAttribute('data-state', 'open');
    confirm.setAttribute('data-editor-drawer', '');
    document.body.append(confirm);
    expect(keyPlaceOf(at('thumbnail'), document).dialogOpen).toBe(true);
  });
});

describe('leaveHref', () => {
  const HERE = 'http://localhost:3000/seed-demo-org/studio/design-1';
  const press = (overrides: Partial<LinkPress> = {}): LinkPress => ({
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    ...overrides,
  });
  const link = (href: string, overrides: Partial<PressedLink> = {}): PressedLink => ({
    href,
    target: '',
    download: false,
    ...overrides,
  });

  it('holds a plain click on a link to another page of the app', () => {
    expect(leaveHref(press(), link('/seed-demo-org/studio'), HERE)).toBe('/seed-demo-org/studio');
    expect(leaveHref(press(), link('/seed-demo-org/composer?group=g1#top'), HERE)).toBe(
      '/seed-demo-org/composer?group=g1#top',
    );
    expect(leaveHref(press(), link('http://localhost:3000/seed-demo-org/media'), HERE)).toBe(
      '/seed-demo-org/media',
    );
    expect(leaveHref(press(), link('../media'), HERE)).toBe('/seed-demo-org/media');
    expect(leaveHref(press(), link('?tab=slides'), HERE)).toBe(
      '/seed-demo-org/studio/design-1?tab=slides',
    );
    expect(leaveHref(press(), link('/seed-demo-org/home', { target: '_self' }), HERE)).toBe(
      '/seed-demo-org/home',
    );
  });

  it('lets a jump within the page go', () => {
    expect(leaveHref(press(), link('#slides'), HERE)).toBeNull();
    expect(leaveHref(press(), link('/seed-demo-org/studio/design-1#top'), HERE)).toBeNull();
    expect(leaveHref(press(), link('/seed-demo-org/studio/design-1'), HERE)).toBeNull();
  });

  it('lets new tabs, downloads and other sites go', () => {
    const away = link('/seed-demo-org/studio');
    expect(leaveHref(press({ button: 1 }), away, HERE)).toBeNull();
    expect(leaveHref(press({ ctrlKey: true }), away, HERE)).toBeNull();
    expect(leaveHref(press({ metaKey: true }), away, HERE)).toBeNull();
    expect(leaveHref(press({ shiftKey: true }), away, HERE)).toBeNull();
    expect(leaveHref(press({ altKey: true }), away, HERE)).toBeNull();
    expect(leaveHref(press({ defaultPrevented: true }), away, HERE)).toBeNull();
    expect(leaveHref(press(), { ...away, target: '_blank' }, HERE)).toBeNull();
    expect(leaveHref(press(), { ...away, download: true }, HERE)).toBeNull();
    expect(leaveHref(press(), link('https://example.com/pricing'), HERE)).toBeNull();
    expect(leaveHref(press(), link('http://localhost:3001/studio/designs'), HERE)).toBeNull();
    expect(leaveHref(press(), link('mailto:hello@example.com'), HERE)).toBeNull();
    expect(leaveHref(press(), link('javascript:void(0)'), HERE)).toBeNull();
    expect(leaveHref(press(), link('http://[broken'), HERE)).toBeNull();
    expect(leaveHref(press(), null, HERE)).toBeNull();
  });
});

describe('linkOf', () => {
  it('reads the link a click landed in, as written', () => {
    document.body.innerHTML = `
      <a href="/seed-demo-org/media" target="_blank" download><span id="inside">Media</span></a>
      <a href="../studio"><svg><path id="icon"></path></svg></a>
      <a id="bare">No link</a>
      <p id="text">Plain</p>
    `;

    const inside = document.getElementById('inside');
    expect(linkOf(inside)).toEqual({
      href: '/seed-demo-org/media',
      target: '_blank',
      download: true,
    });
    expect(linkOf(inside?.firstChild ?? null)).toEqual(linkOf(inside));
    expect(linkOf(document.getElementById('icon'))).toEqual({
      href: '../studio',
      target: '',
      download: false,
    });
    expect(linkOf(document.getElementById('bare'))).toBeNull();
    expect(linkOf(document.getElementById('text'))).toBeNull();
    expect(linkOf(null)).toBeNull();
  });
});

describe('settleWithin', () => {
  it('answers with the save, or false once the wait is over', async () => {
    jest.useFakeTimers();

    await expect(settleWithin(Promise.resolve(true), 1000)).resolves.toBe(true);
    await expect(settleWithin(Promise.resolve(false), 1000)).resolves.toBe(false);
    await expect(settleWithin(Promise.reject(new Error('offline')), 1000)).resolves.toBe(false);

    const hung = settleWithin(new Promise<boolean>(() => undefined), 1000);
    jest.advanceTimersByTime(1000);
    await expect(hung).resolves.toBe(false);
  });
});

describe('pickerCopy', () => {
  it('names each kind of picture', () => {
    expect(pickerCopy({ kind: 'image', slideId: 's6', slot: 'image' })).toEqual({
      title: 'Choose An Image',
      description: 'Choose a picture for this element from your media library, or upload one.',
      confirmLabel: 'Use This Image',
    });
    expect(pickerCopy({ kind: 'logo', slideId: 's6' })).toEqual({
      title: 'Choose A Logo',
      description: 'Choose a logo for this slide from your media library, or upload one.',
      confirmLabel: 'Use This Logo',
    });
    expect(pickerCopy({ kind: 'background', slideId: 's6' })).toEqual({
      title: 'Choose A Background Photo',
      description:
        'Choose a photo to fill this slide behind its text from your media library, or upload one.',
      confirmLabel: 'Use This Photo',
    });
  });
});

describe('pickedMediaId and withPickedMedia', () => {
  it('puts a picture in an image slot', () => {
    const start = design();
    const image = { kind: 'image', slideId: 's6', slot: 'image' } as const;

    expect(pickedMediaId(start, image)).toBeNull();
    const next = withPickedMedia(start, image, 'media-1');
    expect(pickedMediaId(next, image)).toBe('media-1');
    expect(next.slides[5]?.elements.image?.mediaId).toBe('media-1');
  });

  it('shows the brand logo until the slide has its own', () => {
    const start = design();
    const logo = { kind: 'logo', slideId: 's6' } as const;

    expect(pickedMediaId(start, logo)).toBe('brand-logo');
    const next = withPickedMedia(start, logo, 'own-logo');
    expect(pickedMediaId(next, logo)).toBe('own-logo');
    expect(next.slides[5]?.elements.logo?.mediaId).toBe('own-logo');
  });

  it('starts a background photo at the safe darkening, and keeps one already chosen', () => {
    const start = design();
    const background = { kind: 'background', slideId: 's6' } as const;

    expect(pickedMediaId(start, background)).toBeNull();
    const first = withPickedMedia(start, background, 'media-1');
    expect(first.slides[5]?.background).toEqual({
      kind: 'media',
      mediaId: 'media-1',
      overlay: SAFE_PHOTO_OVERLAY,
    });
    expect(pickedMediaId(first, background)).toBe('media-1');

    const lighter = setBackground(first, 's6', { kind: 'media', mediaId: 'media-1', overlay: 0.3 });
    expect(withPickedMedia(lighter, background, 'media-2').slides[5]?.background).toEqual({
      kind: 'media',
      mediaId: 'media-2',
      overlay: 0.3,
    });
  });

  it('changes nothing for a slide that is gone', () => {
    const start = design();
    const gone = { kind: 'background', slideId: 'gone' } as const;

    expect(pickedMediaId(start, gone)).toBeNull();
    expect(withPickedMedia(start, gone, 'media-1')).toBe(start);
    expect(
      withPickedMedia(start, { kind: 'image', slideId: 'gone', slot: 'image' }, 'media-1'),
    ).toBe(start);
  });
});

describe('withOverflow', () => {
  it('hands back the same map when a report changes nothing', () => {
    const once = withOverflow(NO_OVERFLOW, 's1', ['headline']);
    expect(once).toEqual({ s1: ['headline'] });
    expect(withOverflow(once, 's1', ['headline'])).toBe(once);
    expect(withOverflow(NO_OVERFLOW, 's2', [])).toBe(NO_OVERFLOW);
    expect(withOverflow(once, 's2', [])).toBe(once);
  });

  it('takes a changed report in, and drops a slide that fits again', () => {
    const once = withOverflow(NO_OVERFLOW, 's1', ['headline']);
    const both = withOverflow(withOverflow(once, 's1', ['headline', 'body']), 's2', ['body']);
    expect(both).toEqual({ s1: ['headline', 'body'], s2: ['body'] });

    const fits = withOverflow(both, 's1', []);
    expect(fits).toEqual({ s2: ['body'] });
    expect(Object.hasOwn(fits, 's1')).toBe(false);
    expect(both).toEqual({ s1: ['headline', 'body'], s2: ['body'] });
  });

  it('keeps its own copy of the list', () => {
    const slots: SlotId[] = ['headline'];
    const map = withOverflow(NO_OVERFLOW, 's1', slots);
    slots.push('body');
    expect(map.s1).toEqual(['headline']);
  });
});

describe('media refs', () => {
  it('builds one from a library item', () => {
    expect(mediaRefOf(ITEM)).toStrictEqual(BEACH);
  });

  it('builds one from a kit with a logo', () => {
    expect(kitLogoOf(kit())).toStrictEqual({
      mediaId: 'media-logo-1',
      ref: {
        url: LOGO_URL,
        thumbnailUrl: LOGO_URL,
        name: 'Lotus Flow Yoga logo',
        width: null,
        height: null,
      },
    });
    expect(kitLogoOf(kit({ logoMediaId: null }))).toBeNull();
    expect(kitLogoOf(kit({ logoUrl: null }))).toBeNull();
  });

  it('adds a picture, and hands back the same map when it is there already', () => {
    const media = withMediaRef({}, 'media-1', BEACH);
    expect(media).toEqual({ 'media-1': BEACH });
    expect(withMediaRef(media, 'media-1', { ...BEACH })).toBe(media);

    const renamed = withMediaRef(media, 'media-1', { ...BEACH, name: 'Sea.jpg' });
    expect(renamed['media-1']?.name).toBe('Sea.jpg');
    expect(media['media-1']?.name).toBe('Beach.jpg');
  });

  it("adds a kit's logo once, keeping the server's entry for the same file", () => {
    const added = withKitLogo({}, kit());
    expect(added['media-logo-1']?.name).toBe('Lotus Flow Yoga logo');
    expect(withKitLogo(added, kit())).toBe(added);

    const server = {
      'media-logo-1': { ...FOREST, url: LOGO_URL, name: 'lotus-logo.png', width: 400, height: 400 },
    };
    expect(withKitLogo(server, kit())).toBe(server);
    expect(withKitLogo(server, kit({ logoMediaId: null }))).toBe(server);

    const replaced = withKitLogo(server, kit({ logoUrl: 'http://localhost:3001/uploads/new.png' }));
    expect(replaced['media-logo-1']?.url).toBe('http://localhost:3001/uploads/new.png');
  });

  it("merges the server's pictures, and hands back the same map when nothing is new", () => {
    const media = { 'media-1': BEACH };
    expect(mergeMedia(media, {})).toBe(media);
    expect(mergeMedia(media, { 'media-1': { ...BEACH } })).toBe(media);

    expect(mergeMedia(media, { 'media-2': FOREST })).toEqual({
      'media-1': BEACH,
      'media-2': FOREST,
    });
    expect(mergeMedia(media, { 'media-1': { ...BEACH, width: 640 } })['media-1']?.width).toBe(640);
    expect(media).toEqual({ 'media-1': BEACH });
  });
});

describe('loading and saving problems', () => {
  it('reads a failed load', () => {
    expect(loadFailureOf(new ApiError('That design could not be found.', 404))).toEqual({
      kind: 'missing',
    });
    expect(loadFailureOf(new ApiError('Part of it was not recognised.', 422))).toEqual({
      kind: 'unreadable',
      message: 'Part of it was not recognised.',
    });
    expect(loadFailureOf(new ApiError('Something went wrong.', 500))).toEqual({ kind: 'failed' });
    expect(loadFailureOf(new TypeError('Failed to fetch'))).toEqual({ kind: 'failed' });
  });

  it('says why the newer version could not be fetched', () => {
    expect(latestProblem(new ApiError('That design could not be found.', 404))).toBe(
      DESIGN_MISSING_MESSAGE,
    );
    expect(latestProblem(new ApiError('Please sign in again.', 401))).toBe('Please sign in again.');
    expect(latestProblem(new TypeError('Failed to fetch'))).toBe(LATEST_FAILED_MESSAGE);
  });
});

describe('isApplePlatform', () => {
  it('reads the platform the browser reports', () => {
    expect(isApplePlatform({ userAgentData: { platform: 'macOS' } })).toBe(true);
    expect(isApplePlatform({ platform: 'MacIntel' })).toBe(true);
    expect(isApplePlatform({ platform: 'iPhone' })).toBe(true);
    expect(isApplePlatform({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' })).toBe(
      true,
    );
    expect(isApplePlatform({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' })).toBe(
      false,
    );
    expect(isApplePlatform({ userAgentData: { platform: '' }, platform: 'Win32' })).toBe(false);
    expect(isApplePlatform({})).toBe(false);
  });
});

describe('openerOf', () => {
  it("returns what had focus, or a menu's button for one of its items", () => {
    document.body.innerHTML = `
      <button id="reset" type="button">Reset</button>
      <div role="menu" aria-labelledby="reset">
        <div id="item" role="menuitem" tabindex="-1">Reset Slide</div>
      </div>
      <div role="menu"><div id="orphan" role="menuitem" tabindex="-1">Delete</div></div>
    `;

    const reset = document.getElementById('reset');
    expect(openerOf(reset)).toBe(reset);
    expect(openerOf(document.getElementById('item'))).toBe(reset);
    expect(openerOf(document.getElementById('orphan'))).toBeNull();
    expect(openerOf(document.body)).toBeNull();
    expect(openerOf(null)).toBeNull();
  });
});

describe('focusFirstIn', () => {
  it('focuses the first control Tab reaches that can take focus', () => {
    document.body.innerHTML = `
      <div id="area">
        <div tabindex="-1">Not in the tab order</div>
        <button id="off" type="button" tabindex="-1">Slide 1</button>
        <button id="disabled" type="button" disabled>Add Slide</button>
        <button id="actions" type="button">Actions For Slide 2</button>
        <button type="button">Headline</button>
      </div>
      <div id="empty"><span>Nothing to focus</span></div>
    `;

    const area = document.getElementById('area') as HTMLElement;
    expect(focusFirstIn(area)).toBe(true);
    expect(document.activeElement).toBe(document.getElementById('actions'));

    (document.activeElement as HTMLElement).blur();
    expect(focusFirstIn(document.getElementById('empty') as HTMLElement)).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});

describe('placeOf and returnFocus', () => {
  function render(): void {
    document.body.innerHTML = `
      <section id="panel">
        <button id="new" type="button">New Brand Kit</button>
        <ul id="cards">
          <li><button type="button">Edit One</button><button id="delete-1" type="button">Delete One</button></li>
          <li><button type="button">Edit Two</button><button id="delete-2" type="button">Delete Two</button></li>
          <li><button type="button">Edit Three</button><button id="delete-3" type="button">Delete Three</button></li>
        </ul>
      </section>
    `;
  }

  const at = (id: string) => document.getElementById(id) as HTMLElement;
  const panel = () => at('panel');

  it('gives focus back to the control that opened the dialog', () => {
    render();
    const place = placeOf(at('delete-2'));
    expect(place.element).toBe(at('delete-2'));
    expect(place.list).toBe(at('cards'));
    expect([place.item, place.control]).toEqual([1, 1]);
    expect(placeOf(at('new')).list).toBeNull();

    expect(returnFocus(place, panel())).toBe(true);
    expect(document.activeElement).toBe(at('delete-2'));
  });

  it("moves to the same control on the card that took a deleted card's place", () => {
    render();
    const place = placeOf(at('delete-2'));
    at('delete-2').closest('li')?.remove();

    expect(returnFocus(place, panel())).toBe(true);
    expect(document.activeElement).toBe(at('delete-3'));
  });

  it('moves to the card before when the last one went, then to the panel once none is left', () => {
    render();
    const last = placeOf(at('delete-3'));
    at('delete-3').closest('li')?.remove();
    expect(returnFocus(last, panel())).toBe(true);
    expect(document.activeElement).toBe(at('delete-2'));

    const first = placeOf(at('delete-1'));
    for (const item of Array.from(at('cards').children)) item.remove();
    expect(returnFocus(first, panel())).toBe(true);
    expect(document.activeElement).toBe(at('new'));

    // The list itself gone, and no panel to fall back on: nothing takes focus.
    const outside = placeOf(at('new'));
    at('panel').remove();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(returnFocus(outside, null)).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});

describe('backFromComposer', () => {
  it('sees the composer closing back onto this design only', () => {
    const design = '/seed-demo-org/studio/design-1';
    expect(backFromComposer('/seed-demo-org/composer', design, 'seed-demo-org', 'design-1')).toBe(
      true,
    );
    expect(backFromComposer(design, design, 'seed-demo-org', 'design-1')).toBe(false);
    expect(backFromComposer('/seed-demo-org/calendar', design, 'seed-demo-org', 'design-1')).toBe(
      false,
    );
    expect(backFromComposer('/seed-demo-org/composers', design, 'seed-demo-org', 'design-1')).toBe(
      false,
    );
    expect(
      backFromComposer(
        '/seed-demo-org/composer',
        '/seed-demo-org/studio/design-2',
        'seed-demo-org',
        'design-1',
      ),
    ).toBe(false);
    expect(backFromComposer('/other-org/composer', design, 'seed-demo-org', 'design-1')).toBe(
      false,
    );
  });
});
