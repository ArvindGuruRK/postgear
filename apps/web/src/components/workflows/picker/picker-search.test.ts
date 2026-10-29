import { NODE_CATALOG } from '@postgear/automation';
import type { CatalogEntry, WorkspaceCatalog } from '@/types/workflows';
import {
  connectChannelFirst,
  ONE_TRIGGER,
  pickerItems,
  pushRecent,
  recentItems,
  searchPicker,
} from './picker-search';

function catalog(
  connectedPlatforms: WorkspaceCatalog['connectedPlatforms'] = [],
): WorkspaceCatalog {
  const steps = NODE_CATALOG.map(
    (def): CatalogEntry => ({
      type: def.type,
      typeVersion: def.typeVersion,
      category: def.category,
      title: def.title,
      description: def.description,
      keywords: def.keywords,
      icon: def.icon,
      family: def.family,
      priority: def.priority,
      sideEffect: def.sideEffect,
      publishes: def.publishes ?? false,
      connection: def.connection ?? null,
      credits: 0,
      state: def.status === 'comingSoon' ? 'comingSoon' : 'ready',
      runnable: true,
      reason: def.status === 'comingSoon' ? (def.comingSoonReason ?? null) : null,
    }),
  );
  return { steps, connectedPlatforms };
}

const titles = (items: { title: string }[]) => items.map((item) => item.title);

describe('picker items', () => {
  it('hides triggers from a "+" and shows only triggers on an empty canvas', () => {
    const next = pickerItems(catalog(), { placement: 'next', hasTrigger: true });
    expect(next.some((item) => item.category === 'trigger')).toBe(false);
    const first = pickerItems(catalog(), { placement: 'trigger', hasTrigger: false });
    expect(first.every((item) => item.category === 'trigger')).toBe(true);
  });

  it('greys other triggers once one is placed', () => {
    const items = pickerItems(catalog(), { placement: 'panel', hasTrigger: true });
    const manual = items.find((item) => item.type === 'trigger.manual');
    expect(manual?.blocked).toBe(ONE_TRIGGER);
  });

  it('shows one card per platform, blocked until a channel of it is connected', () => {
    const items = pickerItems(catalog(['instagram']), { placement: 'next', hasTrigger: true });
    const instagram = items.find((item) => item.id === 'postgear.publish:instagram');
    const x = items.find((item) => item.id === 'postgear.publish:x');
    expect(instagram).toMatchObject({ title: 'Publish To Instagram', blocked: null });
    expect(instagram?.config).toEqual({ provider: 'instagram' });
    expect(x).toMatchObject({ blocked: connectChannelFirst('X'), fixHref: 'channels' });
    expect(items.some((item) => item.id === 'postgear.publish')).toBe(false);
  });

  it('keeps Coming Soon steps visible but not addable', () => {
    const items = pickerItems(catalog(), { placement: 'next', hasTrigger: true });
    const whatsapp = items.find((item) => item.type === 'notify.whatsapp');
    expect(whatsapp?.state).toBe('comingSoon');
    expect(whatsapp?.blocked).toBeTruthy();
  });
});

describe('searchPicker', () => {
  const items = pickerItems(catalog(), { placement: 'panel', hasTrigger: false });

  it('finds Google Sheets and Excel for "excel", the title match first', () => {
    expect(titles(searchPicker(items, 'excel')).slice(0, 2)).toEqual([
      'Excel: Append Row',
      'Google Sheets: Append Row',
    ]);
  });

  it('puts an exact title first, then titles, then keywords, then descriptions', () => {
    const found = titles(searchPicker(items, 'slack'));
    expect(found[0]).toBe('Slack');
    expect(titles(searchPicker(items, 'filter'))[0]).toBe('Filter');
    // "wait" is a keyword of Delay and of Manual Review, and in Merge's keywords too.
    const wait = titles(searchPicker(items, 'wait'));
    expect(wait).toEqual(expect.arrayContaining(['Delay', 'Manual Review']));
  });

  it('needs every word to match somewhere', () => {
    expect(titles(searchPicker(items, 'append row'))).toEqual([
      'Google Sheets: Append Row',
      'Excel: Append Row',
    ]);
    expect(searchPicker(items, 'slack zebra')).toEqual([]);
  });

  it('puts recently used steps first within a rank', () => {
    const plain = titles(searchPicker(items, 'append row'));
    const recent = titles(searchPicker(items, 'append row', ['data.excelAppendRow']));
    expect(recent).toEqual([...plain].reverse());
  });

  it('keeps five recent items, newest first, without repeats', () => {
    let recent: string[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'b']) recent = pushRecent(recent, id);
    expect(recent).toEqual(['b', 'f', 'e', 'd', 'c']);
    expect(
      recentItems(items, ['notify.slack', 'gone', 'logic.filter']).map((item) => item.id),
    ).toEqual(['notify.slack', 'logic.filter']);
  });

  it('returns everything for an empty search', () => {
    expect(searchPicker(items, '   ')).toHaveLength(items.length);
  });
});
