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
import { contentBox, coversRect, nest, overlapsRect } from './formats';
import {
  decorRect,
  defaultLayoutFor,
  findLayout,
  findRegion,
  LAYOUTS,
  latestLayout,
  layoutKey,
  layoutsForRole,
  logoPlacements,
  parseLayoutKey,
  regionRect,
  SLIDE_ROLES,
  slotPlacement,
} from './layouts';
import { MAX_LIST_ITEMS, type Rect, type RegionId, type SlotBinding, type SlotId } from './types';

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
