/**
 * The Studio editor's decisions (Sprint 9: DS-4.6, DS-4.8, DS-6.2 and
 * DS-6.3), kept out of the island so each one is tested on its own:
 *
 * - how a load of the design reads when it fails (gone, unreadable, or
 *   worth another try), on the server page and in the browser alike;
 * - which keys are the editor's Undo and Redo, and where they are not;
 * - which link clicks wait for a save before the editor lets go;
 * - what the media library says and does for each kind of picture;
 * - how the overflow and media maps change, handing back the same object
 *   when nothing did, so the slides drawn from them do not redraw;
 * - where focus goes back to when a dialog closes.
 *
 * Every function here is a plain function of its arguments. The few that
 * read the page (`keyPlaceOf`, `linkOf`, `openerOf`) only read it, from an
 * element or a document they are handed, so a test gives them a page of its
 * own.
 */
import {
  type DesignDocument,
  SAFE_PHOTO_OVERLAY,
  type SlotId,
  setBackground,
  updateElement,
} from '@postgear/design-engine';
import { ApiError } from '@/lib/api';
import type { MediaItem } from '@/types/media';
import type { BrandKitView, DesignDetail, StudioMediaRef } from '@/types/studio';
import type { MediaPurpose } from './editor-panel';
import { findSlide, logoView } from './editor-panel-model';

// ---------------------------------------------------------------------------
// Loading the design
// ---------------------------------------------------------------------------

/**
 * What the server page hands the island: the design, or why it cannot be
 * opened. Null instead means "load it here": a workspace switch was in
 * flight, or the server's request failed in a way worth another try.
 */
export type DesignOutcome =
  | { kind: 'ready'; design: DesignDetail }
  | { kind: 'unreadable'; message: string };

/** A failed load, read: not there (or another workspace's), unreadable, or worth another try. */
export type LoadFailure =
  | { kind: 'missing' }
  | { kind: 'unreadable'; message: string }
  | { kind: 'failed' };

/** Where the island's own load stands. */
export type DesignLoad = { kind: 'loading' } | DesignOutcome | LoadFailure;

export const DESIGN_MISSING_MESSAGE = 'This design no longer exists. It may have been deleted.';
export const DESIGN_LOAD_FAILED_MESSAGE =
  'This design could not be loaded. Check your connection and try again.';

/**
 * A 404 is a design that is not there, or not this workspace's: the API
 * answers both alike, so nothing about another workspace's design leaks
 * (section 5). A 422 is one this version cannot read, in the API's words.
 * Anything else (a busy server, no connection) may pass, so it is tried
 * again.
 */
export function loadFailureOf(error: unknown): LoadFailure {
  if (error instanceof ApiError) {
    if (error.status === 404) return { kind: 'missing' };
    if (error.status === 422) return { kind: 'unreadable', message: error.message };
  }
  return { kind: 'failed' };
}

// ---------------------------------------------------------------------------
// Saving problems (DS-6.2)
// ---------------------------------------------------------------------------

/** The stories' exact words for a save that found a newer revision. */
export const CONFLICT_MESSAGE = 'This design changed in another tab.';
export const CONFLICT_CHOICES =
  'Reload to see the newer version, or keep yours and save it over that one.';
export const SAVE_FAILED_MESSAGE = 'Your changes could not be saved. Please try again.';
export const LATEST_FAILED_MESSAGE =
  'The latest version could not be loaded. Check your connection and try again.';

/** Why Reload or Keep This Version could not fetch the newer version, in a sentence. */
export function latestProblem(error: unknown): string {
  if (error instanceof ApiError) {
    return error.status === 404 ? DESIGN_MISSING_MESSAGE : error.message;
  }
  return LATEST_FAILED_MESSAGE;
}

// ---------------------------------------------------------------------------
// Undo and Redo from the keyboard (DS-4.8)
// ---------------------------------------------------------------------------

export type EditorShortcut = 'undo' | 'redo';

/** The parts of a key press the decision reads; a `KeyboardEvent` has them all. */
export interface ShortcutPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  isComposing: boolean;
}

/**
 * Where a key went, as far as the editor's shortcuts care (see `keyPlaceOf`).
 *
 * The editor's own drawers (`[data-editor-drawer]`: the rail and the panel
 * below lg) are not dialogs here. They are the same rail and panel the wide
 * layout shows beside the canvas, so a key in one counts as a key in them.
 */
export interface KeyPlace {
  /** Into a field, or into text being typed on the canvas: its own undo applies. */
  typing: boolean;
  /** Into something with an undo or keys of its own: `[data-native-undo]`, a dialog. */
  sheltered: boolean;
  /** A dialog or an alert dialog is open: the canvas is not what is in front. */
  dialogOpen: boolean;
}

/**
 * The letter a key stands for. On a layout without Latin letters (Cyrillic,
 * Greek, Hebrew) it is the key's place on a US keyboard, as the browser's own
 * shortcuts work there; a Latin layout such as Dvorak keeps its own letters.
 */
function keyLetter({ key, code }: Pick<ShortcutPress, 'key' | 'code'>): string | null {
  if (/^[a-z]$/i.test(key)) return key.toLowerCase();
  if (key.length === 1 && key.charCodeAt(0) > 127) {
    return /^Key([A-Z])$/.exec(code)?.[1]?.toLowerCase() ?? null;
  }
  return null;
}

/**
 * The shortcut a key combination is, wherever it was pressed: Ctrl or Cmd +
 * Z undoes, Shift with them redoes, and so does Ctrl + Y. Alt never: Ctrl +
 * Alt is AltGr on many keyboards, which types letters.
 */
export function shortcutOf(press: ShortcutPress): EditorShortcut | null {
  if (!(press.ctrlKey || press.metaKey) || press.altKey) return null;

  const letter = keyLetter(press);
  if (letter === 'z') return press.shiftKey ? 'redo' : 'undo';
  if (letter === 'y' && press.ctrlKey && !press.metaKey && !press.shiftKey) return 'redo';
  return null;
}

/**
 * The editor's Undo or Redo for a key press, or null to leave the key alone:
 * one something else handled or is still composing, one typed into a field
 * or onto the canvas (whose own undo steps back through the typing), one
 * inside a dialog or a `[data-native-undo]` box, or any key while a dialog
 * is open. The editor's own drawers do not count as dialogs (`KeyPlace`).
 */
export function editorShortcut(press: ShortcutPress, place: KeyPlace): EditorShortcut | null {
  if (press.defaultPrevented || press.isComposing) return null;

  const shortcut = shortcutOf(press);
  if (!shortcut) return null;
  return place.typing || place.sheltered || place.dialogOpen ? null : shortcut;
}

/**
 * What takes typing. The canvas types into the renderer's own
 * `contenteditable="plaintext-only"` element, which this matches with
 * whatever is inside it.
 */
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
/** Every dialog but the editor's own drawers (`KeyPlace`). */
const DIALOG = '[role="dialog"]:not([data-editor-drawer]), [role="alertdialog"]';
const SHELTERED = `[data-native-undo], ${DIALOG}`;
/** Radix marks an open dialog, alert dialog, drawer or popover this way. */
const OPEN_DIALOG =
  '[role="dialog"][data-state="open"]:not([data-editor-drawer]), [role="alertdialog"][data-state="open"]';

function elementOf(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  return target instanceof Node ? target.parentElement : null;
}

/** Reads where a key went (`KeyPlace`), from the key's target and the page it is on. */
export function keyPlaceOf(target: EventTarget | null, page: ParentNode): KeyPlace {
  const element = elementOf(target);

  return {
    typing: element?.closest(TYPING) != null,
    sheltered: element?.closest(SHELTERED) != null,
    dialogOpen: page.querySelector(OPEN_DIALOG) !== null,
  };
}

// ---------------------------------------------------------------------------
// Leaving with unsaved changes (DS-6.3)
// ---------------------------------------------------------------------------

/** How long a leave waits for the save before it asks instead. */
export const LEAVE_WAIT_MS = 10_000;

/** The parts of a click the decision reads; a `MouseEvent` has them all. */
export interface LinkPress {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/** A link as written on the page. */
export interface PressedLink {
  /** The `href` attribute as written, relative or not. */
  href: string;
  /** The `target` attribute, or '' without one. */
  target: string;
  download: boolean;
}

/** The link a click landed in, if any. */
export function linkOf(target: EventTarget | null): PressedLink | null {
  const anchor = elementOf(target)?.closest('a[href]');
  if (!anchor) return null;

  return {
    href: anchor.getAttribute('href') ?? '',
    target: anchor.getAttribute('target') ?? '',
    download: anchor.hasAttribute('download'),
  };
}

/**
 * Where a click on a link would take the person away from the editor, as the
 * path to navigate to, or null to let the click do what it would anyway.
 *
 * Only a plain left click on a link that leaves this page inside the app is
 * held: a new tab or window (a modifier, another button, a `target`), a
 * download, another site, and a jump within the page (a hash) all go ahead,
 * since none of them closes the editor.
 */
export function leaveHref(press: LinkPress, link: PressedLink | null, here: string): string | null {
  if (!link || press.defaultPrevented || press.button !== 0) return null;
  if (press.ctrlKey || press.metaKey || press.shiftKey || press.altKey) return null;
  if (link.download) return null;

  const target = link.target.trim().toLowerCase();
  if (target !== '' && target !== '_self') return null;

  let current: URL;
  let next: URL;
  try {
    current = new URL(here);
    next = new URL(link.href, current);
  } catch {
    return null;
  }

  if (next.origin !== current.origin) return null;
  if (next.protocol !== 'http:' && next.protocol !== 'https:') return null;
  if (next.pathname === current.pathname && next.search === current.search) return null;

  return `${next.pathname}${next.search}${next.hash}`;
}

/**
 * A save's answer within `ms`, or false: a request that hangs never holds
 * the person on the page with no way to choose.
 */
export function settleWithin(saving: Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    saving.then(
      (saved) => {
        clearTimeout(timer);
        resolve(saved);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Pictures (DS-4.6)
// ---------------------------------------------------------------------------

export type MediaMap = Readonly<Record<string, StudioMediaRef>>;

/** What the media library says for each kind of picture it is opened for. */
export interface PickerCopy {
  title: string;
  /** Read by screen readers only. */
  description: string;
  confirmLabel: string;
}

export function pickerCopy(purpose: MediaPurpose): PickerCopy {
  switch (purpose.kind) {
    case 'image':
      return {
        title: 'Choose An Image',
        description: 'Choose a picture for this element from your media library, or upload one.',
        confirmLabel: 'Use This Image',
      };
    case 'logo':
      return {
        title: 'Choose A Logo',
        description: 'Choose a logo for this slide from your media library, or upload one.',
        confirmLabel: 'Use This Logo',
      };
    case 'background':
      return {
        title: 'Choose A Background Photo',
        description:
          'Choose a photo to fill this slide behind its text from your media library, or upload one.',
        confirmLabel: 'Use This Photo',
      };
  }
}

/**
 * The picture there now, which the library shows as already chosen: the
 * element's own, the logo the slot shows (its own, or the brand logo), or
 * the slide's background photo.
 */
export function pickedMediaId(document: DesignDocument, purpose: MediaPurpose): string | null {
  const slide = findSlide(document, purpose.slideId)?.slide;
  if (!slide) return null;

  switch (purpose.kind) {
    case 'image':
      return slide.elements[purpose.slot]?.mediaId ?? null;
    case 'logo':
      return logoView(document, slide.elements.logo).mediaId;
    case 'background':
      return slide.background.kind === 'media' ? slide.background.mediaId : null;
  }
}

/**
 * The design with the chosen picture in place. A background photo keeps the
 * darkening the slide's photo had, or starts at the level white text reads
 * on, whatever the photo.
 */
export function withPickedMedia(
  document: DesignDocument,
  purpose: MediaPurpose,
  mediaId: string,
): DesignDocument {
  switch (purpose.kind) {
    case 'image':
      return updateElement(document, purpose.slideId, purpose.slot, { mediaId });
    case 'logo':
      return updateElement(document, purpose.slideId, 'logo', { mediaId });
    case 'background': {
      const slide = findSlide(document, purpose.slideId)?.slide;
      if (!slide) return document;

      const { background } = slide;
      const overlay = background.kind === 'media' ? background.overlay : SAFE_PHOTO_OVERLAY;
      return setBackground(document, purpose.slideId, { kind: 'media', mediaId, overlay });
    }
  }
}

/** A library item as the design's pictures keep it. */
export function mediaRefOf(
  item: Pick<MediaItem, 'url' | 'thumbnailUrl' | 'name' | 'width' | 'height'>,
): StudioMediaRef {
  return {
    url: item.url,
    thumbnailUrl: item.thumbnailUrl,
    name: item.name,
    width: item.width,
    height: item.height,
  };
}

/** A brand kit's logo as a picture the design draws, or null for a kit without one. */
export function kitLogoOf(kit: BrandKitView): { mediaId: string; ref: StudioMediaRef } | null {
  if (!kit.logoMediaId || !kit.logoUrl) return null;

  return {
    mediaId: kit.logoMediaId,
    ref: {
      url: kit.logoUrl,
      thumbnailUrl: kit.logoUrl,
      name: `${kit.name} logo`,
      width: null,
      height: null,
    },
  };
}

function known(media: MediaMap, mediaId: string): StudioMediaRef | undefined {
  return Object.hasOwn(media, mediaId) ? media[mediaId] : undefined;
}

export function sameMediaRef(a: StudioMediaRef | undefined, b: StudioMediaRef): boolean {
  return (
    a !== undefined &&
    a.url === b.url &&
    a.thumbnailUrl === b.thumbnailUrl &&
    a.name === b.name &&
    a.width === b.width &&
    a.height === b.height
  );
}

/** The pictures with one added. The same object when that id already holds the same picture. */
export function withMediaRef(media: MediaMap, mediaId: string, ref: StudioMediaRef): MediaMap {
  return sameMediaRef(known(media, mediaId), ref) ? media : { ...media, [mediaId]: ref };
}

/**
 * The pictures with a kit's logo added. The design's own entry for that logo
 * (the server's, with its real name and size) stays while it is the same
 * file, so applying a kit again redraws nothing.
 */
export function withKitLogo(media: MediaMap, kit: BrandKitView): MediaMap {
  const logo = kitLogoOf(kit);
  if (!logo || known(media, logo.mediaId)?.url === logo.ref.url) return media;
  return withMediaRef(media, logo.mediaId, logo.ref);
}

/** The pictures with the server's added; the same object when it brings nothing new. */
export function mergeMedia(media: MediaMap, incoming: MediaMap): MediaMap {
  let next: Record<string, StudioMediaRef> | null = null;

  for (const [mediaId, ref] of Object.entries(incoming)) {
    if (sameMediaRef(known(media, mediaId), ref)) continue;
    next ??= { ...media };
    next[mediaId] = ref;
  }

  return next ?? media;
}

// ---------------------------------------------------------------------------
// Text too long for its space (DS-4.4)
// ---------------------------------------------------------------------------

/** What each slide's drawing last said is too long for its space, by slide id. */
export type OverflowMap = Readonly<Record<string, readonly SlotId[]>>;

export const NO_OVERFLOW: OverflowMap = {};

function sameSlots(a: readonly SlotId[], b: readonly SlotId[]): boolean {
  return a.length === b.length && a.every((slot, index) => slot === b[index]);
}

/**
 * A slide's report taken in. A drawing reports after it renders, so a report
 * that changes nothing must hand back the same map, or the editor would
 * render again, the drawing report again, and so on for ever.
 */
export function withOverflow(
  map: OverflowMap,
  slideId: string,
  slots: readonly SlotId[],
): OverflowMap {
  const before = Object.hasOwn(map, slideId) ? map[slideId] : undefined;
  if (sameSlots(before ?? [], slots)) return map;

  if (slots.length === 0) {
    return Object.fromEntries(Object.entries(map).filter(([id]) => id !== slideId));
  }
  return { ...map, [slideId]: [...slots] };
}

// ---------------------------------------------------------------------------
// The page around the editor
// ---------------------------------------------------------------------------

/**
 * Whether the address just came back to this design's editor from the
 * composer: its Back after Send To Composer. The composer opens over the
 * editor (a modal route), so the editor stays and only the path changes.
 */
export function backFromComposer(
  previous: string,
  current: string,
  orgId: string,
  designId: string,
): boolean {
  const composer = `/${orgId}/composer`;
  return (
    current === `/${orgId}/studio/${designId}` &&
    (previous === composer || previous.startsWith(`${composer}/`))
  );
}

/** What `navigator` says about the platform; `userAgentData` is not in every browser. */
export interface PlatformHints {
  userAgentData?: { platform?: string } | null;
  platform?: string;
  userAgent?: string;
}

/** Whether shortcut hints should show the Command key rather than Ctrl. */
export function isApplePlatform(hints: PlatformHints): boolean {
  const name = hints.userAgentData?.platform || hints.platform || hints.userAgent || '';
  return /mac|iphone|ipad/i.test(name);
}

/**
 * Where focus goes back to when a dialog closes: whatever had it as the
 * dialog opened. A menu item is gone once its menu closes, so for one the
 * menu's button stands in (Radix names a menu by its trigger).
 */
export function openerOf(active: Element | null): HTMLElement | null {
  if (!(active instanceof HTMLElement)) return null;

  const page = active.ownerDocument;
  if (active === page.body || active === page.documentElement) return null;

  const menu = active.closest('[role="menu"]');
  if (!menu) return active;

  const id = menu.getAttribute('aria-labelledby');
  const trigger = id ? page.getElementById(id) : null;
  return trigger instanceof HTMLElement ? trigger : null;
}

/** The kinds of element Tab can reach. */
const TABBABLE = 'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';

/** The controls in `area` that Tab reaches, in order. */
function tabbablesIn(area: Element): HTMLElement[] {
  return Array.from(area.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (element) => element.tabIndex >= 0,
  );
}

/** Focuses the first of `elements` that can take focus, and says whether one did. */
function focusOneOf(elements: readonly HTMLElement[]): boolean {
  for (const element of elements) {
    element.focus();
    if (element.ownerDocument.activeElement === element) return true;
  }
  return false;
}

/**
 * Gives focus to the first control in `area` that Tab reaches and that can
 * take it (one that is hidden, disabled or inert cannot), and says whether
 * one did. For an alert that goes away with the button that had focus.
 */
export function focusFirstIn(area: HTMLElement): boolean {
  return focusOneOf(tabbablesIn(area));
}

/**
 * Where the control that opened a dialog sat: inside a list item (a card),
 * the item's place in its list and the control's place among the item's
 * controls, so the card that takes a deleted card's place can stand in.
 */
export interface OpenerPlace {
  element: HTMLElement;
  /** The list the control's item is in, or null outside a list. */
  list: Element | null;
  /** The item's place in `list`. */
  item: number;
  /** The control's place among the controls Tab reaches in its item. */
  control: number;
}

export function placeOf(opener: HTMLElement): OpenerPlace {
  const item = opener.closest('li');
  const list = item?.parentElement ?? null;

  return {
    element: opener,
    list,
    item: item && list ? Array.from(list.children).indexOf(item) : -1,
    control: item ? tabbablesIn(item).indexOf(opener) : -1,
  };
}

/**
 * Gives focus back once a dialog has gone, and says whether something took
 * it: to the control that opened the dialog, or, when that control went with
 * what the dialog removed (a deleted card), to the same control on the card
 * that moved into its place (the one before it, when it was the last), and
 * once the list is empty or gone, to the first control in `area`.
 */
export function returnFocus(place: OpenerPlace, area: HTMLElement | null): boolean {
  if (place.element.isConnected && focusOneOf([place.element])) return true;

  const { list } = place;
  if (list?.isConnected && place.item >= 0 && list.children.length > 0) {
    const item = list.children[Math.min(place.item, list.children.length - 1)];
    if (item) {
      const controls = tabbablesIn(item);
      const same = controls[place.control];
      if (focusOneOf(same ? [same, ...controls] : controls)) return true;
    }
  }

  return area ? focusFirstIn(area) : false;
}
