/**
 * The layout library's own guard rail: the geometry rules every other file
 * relies on, checked for every layout in every format it supports.
 *
 * - Everything a user edits sits inside the safe area, inside its region.
 * - Nothing in a region sits on top of anything else in it, including every
 *   spot a logo can move to, so a template can never draw text over text.
 * - A painted block covers a region completely or not at all (`ink.ts`
 *   depends on this to know what colour is behind a piece of text).
 * - The design-wide slots (brand name, handle, slide number) are bound, and
 *   nothing else is.
 */
import {
  contentBox,
  coversRect,
  FORMAT_IDS,
  FORMATS,
  nest,
  overlapsRect,
  shortEdge,
} from './formats';
import {
  decorRect,
  defaultLayoutFor,
  findLayout,
  findRegion,
  findSlot,
  LAYOUTS,
  latestLayout,
  layoutKey,
  layoutsForRole,
  logoPlacements,
  parseLayoutKey,
  regionLabel,
  regionRect,
  SLIDE_ROLES,
  slotFrame,
  slotPlacement,
} from './layouts';
import {
  type ColorRole,
  type FormatId,
  MAX_LIST_ITEMS,
  type Rect,
  type RegionId,
  type SlideLayout,
  type SlideRole,
  type SlotBinding,
  type SlotId,
  type TypeRole,
} from './types';

const EPSILON = 0.01;

function inside(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - EPSILON &&
    inner.y >= outer.y - EPSILON &&
    inner.x + inner.w <= outer.x + outer.w + EPSILON &&
    inner.y + inner.h <= outer.y + outer.h + EPSILON
  );
}

const WHOLE: Rect = { x: 0, y: 0, w: 100, h: 100 };

describe('layout keys', () => {
  it('gives every layout a unique key that parses back', () => {
    const keys = LAYOUTS.map(layoutKey);
    expect(new Set(keys).size).toBe(keys.length);

    for (const layout of LAYOUTS) {
      expect(parseLayoutKey(layoutKey(layout))).toEqual({ id: layout.id, version: layout.version });
    }
  });

  it('refuses keys that are not one', () => {
    for (const key of [
      '',
      'plain',
      'plain@',
      '@1',
      'plain@x',
      'plain@1@2',
      'plain@9',
      'toString@1',
    ]) {
      expect(findLayout(key)).toBeNull();
    }
  });

  it('finds the latest version by id, and nothing by a name from the prototype', () => {
    expect(latestLayout('plain')?.id).toBe('plain');
    for (const id of ['toString', 'constructor', '__proto__']) expect(latestLayout(id)).toBeNull();
  });
});

describe('slide roles', () => {
  it('has a default layout of the right role for every role Add Slide shows', () => {
    for (const role of SLIDE_ROLES) {
      expect(defaultLayoutFor(role).role).toBe(role);
      expect(layoutsForRole(role, 'square').length).toBeGreaterThan(0);
    }
  });
});

describe.each(LAYOUTS.map((layout) => [layoutKey(layout), layout] as const))('%s', (_, layout) => {
  it('supports at least one format, and names unique regions and slots', () => {
    expect(layout.formats.length).toBeGreaterThan(0);
    expect(new Set(layout.regions.map((region) => region.id)).size).toBe(layout.regions.length);
    expect(new Set(layout.slots.map((slot) => slot.id)).size).toBe(layout.slots.length);
  });

  it('places every region inside the safe area, in every format', () => {
    for (const format of layout.formats) {
      for (const region of layout.regions) {
        expect(inside(contentBox(format), regionRect(region, format))).toBe(true);
      }
    }
  });

  it('places every slot, and every spot a logo can move to, inside its region', () => {
    for (const slot of layout.slots) {
      const spots = slot.kind === 'logo' ? logoPlacements(slot) : [null];

      for (const placement of spots) {
        const where = slotPlacement(slot, placement ? { placement } : null);
        expect(findRegion(layout, where.region)).not.toBeNull();
        expect(inside(WHOLE, where.box)).toBe(true);
      }
    }
  });

  it('never puts one element on top of another, wherever the logo is', () => {
    const boxes: Array<{ id: string; region: RegionId; box: Rect; logo: boolean }> = [];

    for (const slot of layout.slots) {
      if (slot.kind === 'logo') {
        for (const placement of logoPlacements(slot)) {
          const where = slotPlacement(slot, { placement });
          boxes.push({ id: `logo:${placement}`, region: where.region, box: where.box, logo: true });
        }
      } else {
        boxes.push({ id: slot.id, region: slot.region, box: slot.box, logo: false });
      }
    }

    const clashes: string[] = [];

    for (const [index, a] of boxes.entries()) {
      for (const b of boxes.slice(index + 1)) {
        // Two spots of the same logo never show at once.
        if (a.logo && b.logo) continue;
        if (a.region === b.region && overlapsRect(a.box, b.box))
          clashes.push(`${a.id} and ${b.id}`);
      }
    }

    expect(clashes).toEqual([]);
  });

  it('paints blocks that cover a region completely or leave it alone, in every format', () => {
    for (const format of layout.formats) {
      for (const decor of layout.decor ?? []) {
        if (decor.kind !== 'block') continue;

        const block = decorRect(layout, decor, format);
        expect(block).not.toBeNull();

        for (const region of layout.regions) {
          const area = regionRect(region, format);
          const straddles = block && overlapsRect(block, area) && !coversRect(block, area);

          if (straddles) {
            throw new Error(`A block straddles the ${region.id} region in ${format}.`);
          }
        }
      }
    }
  });

  it('binds the design-wide slots, and only those', () => {
    const expected: Partial<Record<SlotId, SlotBinding>> = {
      brandName: 'brandName',
      handle: 'handle',
      pageNumber: 'slideNumber',
    };

    for (const slot of layout.slots) {
      expect(slot.bind).toBe(expected[slot.id]);
      if (slot.bind) expect(slot.kind).toBe('text');
    }
  });

  it('starts a logo in a spot it offers, drawn where that spot is', () => {
    for (const slot of layout.slots) {
      if (slot.kind !== 'logo') {
        expect(slot.spots).toBeUndefined();
        continue;
      }

      const spot = slot.placement ? slot.spots?.[slot.placement] : undefined;
      expect(spot).toBeDefined();
      expect({ region: slot.region, box: slot.box, align: slot.align }).toEqual(spot);
    }
  });

  it('only offers options that mean something for the slot', () => {
    for (const slot of layout.slots) {
      if (slot.kind === 'list') {
        expect(slot.maxItems).toBeGreaterThan(0);
        expect(slot.maxItems).toBeLessThanOrEqual(MAX_LIST_ITEMS);
      }
      if (slot.kind === 'image' || slot.kind === 'logo') {
        expect(slot.resizable).toBeFalsy();
        expect(slot.alignable).toBeFalsy();
        expect(slot.colorable).toBeFalsy();
      }
      if (slot.kind === 'text' || slot.kind === 'list') expect(slot.type).toBeDefined();
      if (slot.defaultHidden) expect(slot.optional).toBe(true);
      expect(slot.label.trim()).not.toBe('');
    }
  });

  it('draws every region it declares, so the drag outline never names an empty one', () => {
    for (const region of layout.regions) {
      const used =
        layout.slots.some((slot) => {
          if (slot.region === region.id) return true;
          return logoPlacements(slot).some(
            (placement) => slotPlacement(slot, { placement }).region === region.id,
          );
        }) || layout.decor?.some((decor) => decor.region === region.id);

      expect(used).toBeTruthy();
    }
  });

  it('keeps a slot nested inside the canvas in every format', () => {
    for (const format of layout.formats) {
      for (const slot of layout.slots) {
        const region = findRegion(layout, slot.region);
        if (region) expect(inside(WHOLE, nest(regionRect(region, format), slot.box))).toBe(true);
      }
    }
  });
});

/**
 * The Signature family, ported from CarouselClick's stacked layout. The rules
 * above already hold it to everything every layout keeps; these pin what the
 * port promises: the six layouts and their slots, the bands they sit on, the
 * roles the signature themes are tuned for, the accent rule, and a logo that
 * covers no word wherever it goes.
 */
describe('the Signature family', () => {
  /** Each layout's role and slots, in panel order, as the sprint document lists them. */
  const FAMILY: Record<string, { role: SlideRole; slots: SlotId[] }> = {
    'signature-cover': {
      role: 'cover',
      slots: ['logo', 'eyebrow', 'headline', 'subheadline', 'footer'],
    },
    'signature-content': {
      role: 'content',
      slots: ['logo', 'eyebrow', 'headline', 'body', 'footer'],
    },
    'signature-list': { role: 'list', slots: ['logo', 'headline', 'list', 'footer'] },
    'signature-stat': {
      role: 'statistic',
      slots: ['logo', 'eyebrow', 'stat', 'statLabel', 'footer'],
    },
    'signature-quote': { role: 'quote', slots: ['logo', 'quote', 'attribution', 'footer'] },
    'signature-closing': {
      role: 'closing',
      slots: ['logo', 'headline', 'body', 'cta', 'footer'],
    },
  };

  /** CarouselClick's bands, as fractions of the slide (its `editor/layout.ts`). */
  const BANDS: Record<FormatId, Record<'header' | 'title' | 'body' | 'footer', Rect>> = {
    square: {
      header: { x: 0.075, y: 0.06, w: 0.85, h: 0.15 },
      title: { x: 0.075, y: 0.22, w: 0.85, h: 0.3 },
      body: { x: 0.075, y: 0.53, w: 0.85, h: 0.2 },
      footer: { x: 0.075, y: 0.75, w: 0.85, h: 0.19 },
    },
    portrait: {
      header: { x: 0.075, y: 0.055, w: 0.85, h: 0.14 },
      title: { x: 0.075, y: 0.2, w: 0.85, h: 0.25 },
      body: { x: 0.075, y: 0.46, w: 0.85, h: 0.19 },
      footer: { x: 0.075, y: 0.665, w: 0.85, h: 0.26 },
    },
    story: {
      header: { x: 0.075, y: 0.1, w: 0.85, h: 0.12 },
      title: { x: 0.075, y: 0.24, w: 0.85, h: 0.24 },
      body: { x: 0.075, y: 0.5, w: 0.85, h: 0.16 },
      footer: { x: 0.075, y: 0.68, w: 0.85, h: 0.16 },
    },
    landscape: {
      header: { x: 0.06, y: 0.08, w: 0.4, h: 0.2 },
      title: { x: 0.06, y: 0.3, w: 0.4, h: 0.6 },
      body: { x: 0.53, y: 0.12, w: 0.41, h: 0.5 },
      footer: { x: 0.53, y: 0.66, w: 0.41, h: 0.24 },
    },
  };

  /** Which region holds each band, and what the editor calls it while dragging. */
  const BAND_REGIONS = [
    { band: 'header', region: 'header', label: 'Header' },
    { band: 'title', region: 'body', label: 'Title' },
    { band: 'body', region: 'aside', label: 'Body' },
    { band: 'footer', region: 'footer', label: 'Footer' },
  ] as const;

  function family(): SlideLayout[] {
    return Object.keys(FAMILY).map((id) => {
      const layout = latestLayout(id);
      if (!layout) throw new Error(`The ${id} layout is missing.`);
      return layout;
    });
  }

  /** The part of `rect` inside `box`. */
  function clampInto(rect: Rect, box: Rect): Rect {
    const x = Math.max(rect.x, box.x);
    const y = Math.max(rect.y, box.y);
    const right = Math.min(rect.x + rect.w, box.x + box.w);
    const bottom = Math.min(rect.y + rect.h, box.y + box.h);
    return { x, y, w: right - x, h: bottom - y };
  }

  it('has all six, at version 1, with the role and the slots each one promises', () => {
    for (const [id, expected] of Object.entries(FAMILY)) {
      const layout = latestLayout(id);

      expect(layout?.version).toBe(1);
      expect(layout?.role).toBe(expected.role);
      // The slide number is an extra a layout may add, hidden until asked for.
      const slots = layout?.slots.map((slot) => slot.id).filter((slot) => slot !== 'pageNumber');
      expect(slots).toEqual(expected.slots);
    }
  });

  it('draws every one in all four formats', () => {
    for (const layout of family()) {
      expect([...layout.formats].sort()).toEqual([...FORMAT_IDS].sort());
    }
  });

  it("lays its regions on CarouselClick's bands, clamped into the safe area", () => {
    for (const layout of family()) {
      expect(layout.regions.map((region) => region.id).sort()).toEqual(
        BAND_REGIONS.map((entry) => entry.region).sort(),
      );

      for (const format of FORMAT_IDS) {
        for (const { band, region: id, label } of BAND_REGIONS) {
          const fraction = BANDS[format][band];
          const expected = clampInto(
            { x: fraction.x * 100, y: fraction.y * 100, w: fraction.w * 100, h: fraction.h * 100 },
            contentBox(format),
          );
          const region = findRegion(layout, id);
          if (!region) throw new Error(`${layout.id} has no ${id} region.`);

          const actual = regionRect(region, format);
          expect(actual.x).toBeCloseTo(expected.x, 2);
          expect(actual.y).toBeCloseTo(expected.y, 2);
          expect(actual.w).toBeCloseTo(expected.w, 2);
          expect(actual.h).toBeCloseTo(expected.h, 2);
          expect(regionLabel(region)).toBe(label);
        }
      }
    }
  });

  it('sets each slot in the type and colour role the signature themes are tuned for', () => {
    const ROLES: Partial<Record<SlotId, [TypeRole, ColorRole]>> = {
      eyebrow: ['eyebrow', 'primary'],
      headline: ['headline', 'text'],
      subheadline: ['subheadline', 'textMuted'],
      // Supporting text whatever its slot is called.
      body: ['subheadline', 'textMuted'],
      list: ['list', 'textMuted'],
      stat: ['stat', 'text'],
      statLabel: ['statLabel', 'textMuted'],
      quote: ['quote', 'text'],
      attribution: ['attribution', 'textMuted'],
      // CarouselClick sets its footer line at call-to-action size.
      footer: ['cta', 'primary'],
      cta: ['cta', 'primary'],
      pageNumber: ['pageNumber', 'textMuted'],
    };

    for (const layout of family()) {
      for (const slot of layout.slots) {
        if (slot.kind === 'logo') continue;

        const expected = ROLES[slot.id];
        expect(expected).toBeDefined();
        expect([layout.id, slot.id, slot.type, slot.colorRole]).toEqual([
          layout.id,
          slot.id,
          ...(expected ?? []),
        ]);
        if (slot.kind === 'list') expect(slot.marker).toBe('number');
        if (slot.id === 'pageNumber') expect(slot.defaultHidden).toBe(true);
      }
    }
  });

  it('opens the footer with the accent rule: a round-ended pill in primary, inside the footer', () => {
    for (const layout of family()) {
      const rules = (layout.decor ?? []).filter((decor) => decor.kind === 'rule');
      expect(rules).toHaveLength(1);

      const [rule] = rules;
      expect(rule.region).toBe('footer');
      expect(rule.colorRole).toBe('primary');
      expect([rule.box.x, rule.box.y]).toEqual([0, 0]);

      const footer = findRegion(layout, 'footer');
      if (!footer) throw new Error(`${layout.id} has no footer region.`);

      for (const format of layout.formats) {
        const box = decorRect(layout, rule, format);
        if (!box) throw new Error(`${layout.id} draws no rule in ${format}.`);

        expect(inside(regionRect(footer, format), box)).toBe(true);

        // Rounded by at least half its thickness, so CSS draws round ends.
        const thickness = (box.h / 100) * FORMATS[format].height;
        const rounding = ((rule.radius ?? 0) / 100) * shortEdge(format);
        expect(rounding).toBeGreaterThanOrEqual(thickness / 2);
      }
    }
  });

  it('offers the logo in the header, the centre and the footer, starting in the header', () => {
    for (const layout of family()) {
      const logo = findSlot(layout, 'logo');

      expect(logo && logoPlacements(logo)).toEqual(['header', 'centre', 'footer']);
      expect(logo?.placement).toBe('header');
    }
  });

  it('never puts the logo over a word, in any spot and any format', () => {
    const clashes: string[] = [];

    for (const layout of family()) {
      const logo = findSlot(layout, 'logo');
      if (!logo) throw new Error(`${layout.id} has no logo.`);

      for (const format of layout.formats) {
        for (const placement of logoPlacements(logo)) {
          // On the canvas, not in region percentages, so a spot cannot hide
          // over a word that belongs to another region.
          const spot = slotFrame(layout, logo, format, { placement });
          if (!spot) throw new Error(`${layout.id} cannot place its logo in ${placement}.`);

          for (const slot of layout.slots) {
            if (slot.kind !== 'text' && slot.kind !== 'list') continue;

            const frame = slotFrame(layout, slot, format, null);
            if (frame && overlapsRect(spot.rect, frame.rect)) {
              clashes.push(`${layout.id} in ${format}, logo in ${placement}, over ${slot.id}`);
            }
          }
        }
      }
    }

    expect(clashes).toEqual([]);
  });
});
