/**
 * The pages and quick actions the search box can jump to (2026-10-21).
 *
 * Matched here in the browser, with no request: they are the same for every
 * workspace and instant to find. `keywords` are the other words a person might
 * type for the same place ("plan" for Billing, "theme" for Appearance), so a
 * search finds what they mean and not only what the page is called.
 */

export type SearchPageIcon =
  | 'home'
  | 'calendar'
  | 'sparkles'
  | 'queue'
  | 'analytics'
  | 'media'
  | 'seo'
  | 'channels'
  | 'team'
  | 'billing'
  | 'key'
  | 'webhook'
  | 'signature'
  | 'bell'
  | 'palette'
  | 'create'
  | 'connect';

export interface SearchPage {
  id: string;
  label: string;
  /** Where it goes, after `/${orgId}`. */
  path: string;
  icon: SearchPageIcon;
  /** Pages sit under "Pages"; the two that start something sit under "Quick actions". */
  group: 'page' | 'action';
  /** What to show beside the label, for the ones that live inside Settings. */
  hint?: string;
  keywords: string[];
}

export const SEARCH_PAGES: SearchPage[] = [
  {
    id: 'create-post',
    label: 'Create post',
    path: '/composer',
    icon: 'create',
    group: 'action',
    keywords: ['new', 'write', 'compose', 'draft', 'schedule'],
  },
  {
    id: 'connect-channel',
    label: 'Connect a channel',
    path: '/channels',
    icon: 'connect',
    group: 'action',
    keywords: ['add', 'new', 'account', 'link', 'social', 'platform'],
  },
  {
    id: 'home',
    label: 'Home',
    path: '/home',
    icon: 'home',
    group: 'page',
    keywords: ['dashboard', 'start', 'overview'],
  },
  {
    id: 'calendar',
    label: 'Calendar',
    path: '/calendar',
    icon: 'calendar',
    group: 'page',
    keywords: ['schedule', 'planner', 'week', 'month', 'day'],
  },
  {
    id: 'copilot',
    label: 'AI Copilot',
    path: '/ai-copilot',
    icon: 'sparkles',
    group: 'page',
    keywords: ['ai', 'assistant', 'generate', 'agent', 'chat'],
  },
  {
    id: 'queue',
    label: 'Queue',
    path: '/queue',
    icon: 'queue',
    group: 'page',
    keywords: ['scheduled', 'publishing', 'failed', 'upcoming', 'posts'],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    path: '/analytics',
    icon: 'analytics',
    group: 'page',
    keywords: ['metrics', 'insights', 'reports', 'performance', 'stats'],
  },
  {
    id: 'media',
    label: 'Media',
    path: '/media',
    icon: 'media',
    group: 'page',
    keywords: ['images', 'videos', 'library', 'uploads', 'files', 'photos'],
  },
  {
    id: 'seo',
    label: 'SEO Analyzer',
    path: '/seo-analyzer',
    icon: 'seo',
    group: 'page',
    keywords: ['audit', 'crawl', 'website', 'ranking', 'keywords'],
  },
  {
    id: 'channels',
    label: 'Channels',
    path: '/channels',
    icon: 'channels',
    group: 'page',
    keywords: ['accounts', 'social', 'connected', 'platforms'],
  },
  {
    id: 'team',
    label: 'Team',
    path: '/settings/team',
    icon: 'team',
    group: 'page',
    hint: 'Settings',
    keywords: ['members', 'invite', 'people', 'users', 'roles', 'workspace'],
  },
  {
    id: 'billing',
    label: 'Billing',
    path: '/settings/billing',
    icon: 'billing',
    group: 'page',
    hint: 'Settings',
    keywords: ['plan', 'subscription', 'invoice', 'payment', 'upgrade', 'credits'],
  },
  {
    id: 'api-keys',
    label: 'API keys',
    path: '/settings/api-keys',
    icon: 'key',
    group: 'page',
    hint: 'Settings',
    keywords: ['developers', 'token', 'integration', 'public'],
  },
  {
    id: 'webhooks',
    label: 'Webhooks',
    path: '/settings/webhooks',
    icon: 'webhook',
    group: 'page',
    hint: 'Settings',
    keywords: ['events', 'endpoint', 'callback', 'developers'],
  },
  {
    id: 'signatures',
    label: 'Signatures',
    path: '/settings/signatures',
    icon: 'signature',
    group: 'page',
    hint: 'Settings',
    keywords: ['sign-off', 'footer', 'snippet', 'hashtags'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    path: '/settings/notifications',
    icon: 'bell',
    group: 'page',
    hint: 'Settings',
    keywords: ['alerts', 'email', 'reminders'],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    path: '/settings/appearance',
    icon: 'palette',
    group: 'page',
    hint: 'Settings',
    keywords: ['theme', 'dark', 'light', 'colors', 'mode', 'avatar'],
  },
];

/** How many pages and actions one search shows. */
export const MAX_PAGE_RESULTS = 5;

/**
 * The pages and actions that hold every typed word in their name, their
 * section or their keywords. Names that start with the first word come first;
 * otherwise the order above holds. An empty search matches nothing.
 */
export function findPages(query: string, pages: SearchPage[] = SEARCH_PAGES): SearchPage[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  if (terms.length === 0) {
    return [];
  }

  const matches = pages.filter((page) => {
    const haystack = [page.label, page.hint ?? '', ...page.keywords].join(' ').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });

  const startsWith = (page: SearchPage) => page.label.toLowerCase().startsWith(terms[0]);

  // `sort` is stable, so equal ranks keep the order of the list.
  return [...matches]
    .sort((a, b) => Number(startsWith(b)) - Number(startsWith(a)))
    .slice(0, MAX_PAGE_RESULTS);
}

/** What the box offers before anything is typed. */
export function quickActions(pages: SearchPage[] = SEARCH_PAGES): SearchPage[] {
  return pages.filter((page) => page.group === 'action');
}
