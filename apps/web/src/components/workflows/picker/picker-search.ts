/**
 * What the step picker lists and how its search ranks (Module 05,
 * blueprint 4.4). Pure, so the order people see is unit tested.
 *
 * - **Items** come from `GET /automations/catalog`. Publish To Channel
 *   becomes one item per platform ("Publish To Instagram"), each needing a
 *   connected channel of that platform.
 * - **Placement** decides what shows: from a "+" ("What happens next?")
 *   triggers are hidden; on an empty canvas only triggers show; the docked
 *   panel shows everything, with triggers greyed once one is placed.
 * - **Search** ranks an exact title first, then titles that contain the
 *   words, then keywords ("excel" finds Google Sheets too), then
 *   descriptions; recently used steps go first within a rank.
 */
import { type NodeCategory, PUBLISH_PLATFORMS } from '@postgear/automation';
import type { CatalogEntry, CatalogState, WorkspaceCatalog } from '@/types/workflows';

export type PickerPlacement = 'panel' | 'next' | 'trigger';

export interface PickerItem {
  /** The step type, or `postgear.publish:<platform>` for a platform card. */
  id: string;
  type: string;
  /** Settings the new step starts with (the platform of a publish card). */
  config?: Record<string, unknown>;
  category: NodeCategory;
  title: string;
  description: string;
  keywords: readonly string[];
  icon: string;
  state: CatalogState;
  /** Why it cannot be added, in a sentence; null when it can. */
  blocked: string | null;
  /** A link to fix what blocks it (Channels), when there is one. */
  fixHref: 'channels' | null;
}

export const PICKER_CATEGORIES: readonly { id: NodeCategory; title: string }[] = [
  { id: 'trigger', title: 'Triggers' },
  { id: 'postgear', title: 'PostGear' },
  { id: 'social', title: 'Social Channels' },
  { id: 'ai', title: 'AI' },
  { id: 'logic', title: 'Logic' },
  { id: 'notify', title: 'Notify' },
  { id: 'data', title: 'Data' },
];

export const ONE_TRIGGER = 'A workflow can have only one trigger.';
export const RECENT_LIMIT = 5;

export function connectChannelFirst(platform: string): string {
  return `Connect a ${platform} channel first.`;
}

function fromEntry(entry: CatalogEntry): PickerItem {
  return {
    id: entry.type,
    type: entry.type,
    category: entry.category,
    title: entry.title,
    description: entry.description,
    keywords: entry.keywords,
    icon: entry.icon,
    state: entry.state,
    blocked: entry.state === 'comingSoon' ? (entry.reason ?? 'Coming soon') : null,
    fixHref: null,
  };
}

/** Every item the picker can show for this workspace, in library order. */
export function pickerItems(
  catalog: WorkspaceCatalog,
  options: { placement: PickerPlacement; hasTrigger: boolean },
): PickerItem[] {
  const items: PickerItem[] = [];
  for (const entry of catalog.steps) {
    const isTrigger = entry.category === 'trigger';
    if (options.placement === 'next' && isTrigger) continue;
    if (options.placement === 'trigger' && !isTrigger) continue;

    if (entry.type === 'postgear.publish') {
      for (const platform of PUBLISH_PLATFORMS) {
        const connected = catalog.connectedPlatforms.includes(platform.id);
        items.push({
          ...fromEntry(entry),
          id: `${entry.type}:${platform.id}`,
          config: { provider: platform.id },
          title: `Publish To ${platform.title}`,
          description: `Publishes a post right away on your ${platform.title} channels.`,
          keywords: [...entry.keywords, platform.title.toLowerCase(), platform.id],
          icon: platform.icon,
          state: entry.state === 'comingSoon' ? 'comingSoon' : 'ready',
          blocked:
            entry.state === 'comingSoon'
              ? (entry.reason ?? 'Coming soon')
              : connected
                ? null
                : connectChannelFirst(platform.title),
          fixHref: entry.state !== 'comingSoon' && !connected ? 'channels' : null,
        });
      }
      continue;
    }

    const item = fromEntry(entry);
    if (isTrigger && options.hasTrigger && !item.blocked) item.blocked = ONE_TRIGGER;
    items.push(item);
  }
  return items;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9#]+/)
    .filter(Boolean);
}

/** 0 exact title, 1 title, 2 keyword, 3 description, null no match. */
function rank(item: PickerItem, query: string): number | null {
  const title = item.title.toLowerCase();
  if (title === query) return 0;
  const parts = words(query);
  if (parts.length === 0) return null;
  const titleWords = words(item.title);
  const keywordWords = item.keywords.flatMap((keyword) => words(keyword));
  const descriptionWords = words(item.description);
  let worst = 0;
  for (const part of parts) {
    const starts = (list: string[]) => list.some((word) => word.startsWith(part));
    const tier = starts(titleWords)
      ? 1
      : starts(keywordWords)
        ? 2
        : starts(descriptionWords)
          ? 3
          : null;
    if (tier === null) return null;
    worst = Math.max(worst, tier);
  }
  return worst;
}

/** The items matching `query`, best first. An empty query returns them as they are. */
export function searchPicker(
  items: readonly PickerItem[],
  query: string,
  recent: readonly string[] = [],
): PickerItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  const recentIndex = (id: string) => {
    const index = recent.indexOf(id);
    return index === -1 ? RECENT_LIMIT : index;
  };
  return items
    .map((item, order) => ({ item, order, tier: rank(item, needle) }))
    .filter((hit): hit is { item: PickerItem; order: number; tier: number } => hit.tier !== null)
    .sort(
      (a, b) =>
        a.tier - b.tier || recentIndex(a.item.id) - recentIndex(b.item.id) || a.order - b.order,
    )
    .map((hit) => hit.item);
}

/** The Recent group: up to five items used last, newest first. */
export function recentItems(items: readonly PickerItem[], recent: readonly string[]): PickerItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return recent
    .map((id) => byId.get(id))
    .filter((item): item is PickerItem => item !== undefined)
    .slice(0, RECENT_LIMIT);
}

/** `recent` with `id` moved to the front, capped at five. */
export function pushRecent(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter((other) => other !== id)].slice(0, RECENT_LIMIT);
}

export function itemsIn(items: readonly PickerItem[], category: NodeCategory): PickerItem[] {
  return items.filter((item) => item.category === category);
}
