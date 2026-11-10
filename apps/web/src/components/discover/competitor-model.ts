/**
 * The Add and Edit Competitor dialog's logic (Module 07, story DC-7.1), kept
 * pure so its rules and its words are tested on their own: which feeds are in
 * the list and which are ticked, what a pasted address becomes, what each
 * field must look like before anything is sent, and the body that is sent.
 *
 * The API checks all of this again and answers a wrong shape with "Invalid
 * input" and nothing else, so the sentence that says which field is wrong has
 * to come from here. The website is checked for being an address at all; where
 * it leads is the API's to judge, in its own sentence.
 */
import type { Competitor, CompetitorInput, DiscoveredFeed } from '@/types/discover';

export const COMPETITOR_NAME_MAX = 80;
export const MAX_COMPETITOR_FEEDS = 5;
export const NEWS_QUERY_MIN = 2;
export const NEWS_QUERY_MAX = 80;

export const NO_FEEDS_FOUND = 'No feeds found. You can paste a feed address.';
export const FINDING_FEEDS = 'Finding feeds...';
export const FEEDS_FULL = 'A competitor can have up to 5 feeds.';
export const FEED_REPEATED = 'That feed is already in the list.';
export const FEED_NOT_AN_ADDRESS = 'That does not look like a feed address.';
export const FIND_FAILED = 'We could not look for feeds. Try again in a moment.';
export const SAVE_FAILED = 'We could not save the competitor. Try again in a moment.';
export const REMOVE_FAILED = 'We could not remove the competitor. Try again in a moment.';
export const COMPETITORS_FAILED = 'Try again in a moment.';
export const ITEMS_FAILED = 'We could not load what they published. Try again in a moment.';
export const NAME_NEEDED = 'Enter a name for the competitor.';
export const WEBSITE_HINT = 'A website looks like example.com, with no spaces.';
export const STILL_READING = 'We are still reading what they published. Try again in a moment.';
export const YOUTUBE_HINT = 'A channel id starts with UC and is 24 characters long.';
export const BLUESKY_HINT = 'A handle looks like name.bsky.social.';
export const MASTODON_HINT = 'An account looks like name@instance.';
export const NEWS_HINT =
  'What Google News is searched for. Leave it as the name to follow the name.';
export const NEWS_LENGTH = 'A search phrase is 2 to 80 characters.';

/** One feed in the dialog's list: found on the website, saved earlier, or pasted. */
export interface FeedChoice {
  url: string;
  /** The feed's name as the site gives it. Empty for a saved or pasted address. */
  title: string;
  /** Null when all we have is the address. */
  kind: DiscoveredFeed['kind'] | null;
  checked: boolean;
}

/** What the dialog's fields hold while it is open. Text as typed, trimmed only on the way out. */
export interface CompetitorForm {
  name: string;
  website: string;
  feeds: FeedChoice[];
  youtube: string;
  bluesky: string;
  mastodon: string;
  news: string;
  /** Whether the person wrote the search phrase themselves. Until then it follows the name. */
  newsEdited: boolean;
}

const FEED_KIND_NAMES: Record<DiscoveredFeed['kind'], string> = { rss: 'RSS', atom: 'Atom' };

/** "Blog, RSS", or the address when the feed has no name, or the address alone when that is all there is. */
export function feedChoiceLabel(feed: Pick<FeedChoice, 'url' | 'title' | 'kind'>): string {
  const name = feed.title.trim() || feed.url;
  return feed.kind ? `${name}, ${FEED_KIND_NAMES[feed.kind]}` : name;
}

/** Whether the address is worth a second line: only when the first line is not already it. */
export function feedChoiceShowsAddress(feed: Pick<FeedChoice, 'title'>): boolean {
  return feed.title.trim() !== '';
}

function tickedCount(feeds: readonly FeedChoice[]): number {
  return feeds.filter((feed) => feed.checked).length;
}

/** A blank form, or one that starts from what was saved. */
export function formFrom(competitor: Competitor | null): CompetitorForm {
  if (!competitor) {
    return {
      name: '',
      website: '',
      feeds: [],
      youtube: '',
      bluesky: '',
      mastodon: '',
      news: '',
      newsEdited: false,
    };
  }

  return {
    name: competitor.name,
    website: competitor.websiteUrl ?? '',
    feeds: competitor.feedUrls.map((url) => ({ url, title: '', kind: null, checked: true })),
    youtube: competitor.youtubeChannelId ?? '',
    bluesky: competitor.blueskyHandle ?? '',
    mastodon: competitor.mastodonAcct ?? '',
    news: competitor.newsQuery ?? '',
    // A saved phrase is the person's own. No saved phrase means it follows the name.
    newsEdited: competitor.newsQuery !== null,
  };
}

/** What the search phrase field shows: the person's own words, or the name until they write some. */
export function newsPhrase(form: Pick<CompetitorForm, 'name' | 'news' | 'newsEdited'>): string {
  return form.newsEdited ? form.news : form.name;
}

/**
 * The list after a website's feeds came back. What was already there stays as
 * it was (a feed found again takes the name the site gives it); new ones are
 * added ticked while fewer than five are, and unticked after that.
 */
export function mergeFoundFeeds(
  current: readonly FeedChoice[],
  found: readonly DiscoveredFeed[],
): FeedChoice[] {
  const feeds = current.map((feed) => ({ ...feed }));

  for (const candidate of found) {
    const known = feeds.find((feed) => feed.url === candidate.url);
    if (known) {
      known.title = candidate.title;
      known.kind = candidate.kind;
      continue;
    }
    feeds.push({
      url: candidate.url,
      title: candidate.title,
      kind: candidate.kind,
      checked: tickedCount(feeds) < MAX_COMPETITOR_FEEDS,
    });
  }
  return feeds;
}

/**
 * A pasted feed as an address: http or https, with `https://` put in front of
 * one typed without it. Null when it cannot be one.
 */
export function feedAddress(text: string): string | null {
  const typed = text.trim();
  if (!typed || /\s/.test(typed)) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
  try {
    const url = new URL(withScheme);
    const isWeb = url.protocol === 'https:' || url.protocol === 'http:';
    return isWeb && url.hostname.includes('.') ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The website as an address: the same reading as a feed, without asking for a
 * dot in the host. `localhost:3000` is an address too, and it is the API that
 * says why that one is refused.
 */
export function websiteAddress(text: string): string | null {
  const typed = text.trim();
  if (!typed || /\s/.test(typed)) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export type FeedListChange = { ok: true; feeds: FeedChoice[] } | { ok: false; problem: string };

/** Adds a pasted address, ticked, or says why not. */
export function addPastedFeed(current: readonly FeedChoice[], text: string): FeedListChange {
  const url = feedAddress(text);
  if (!url) return { ok: false, problem: FEED_NOT_AN_ADDRESS };
  if (current.some((feed) => feed.url === url)) return { ok: false, problem: FEED_REPEATED };
  if (tickedCount(current) >= MAX_COMPETITOR_FEEDS) return { ok: false, problem: FEEDS_FULL };

  return { ok: true, feeds: [...current, { url, title: '', kind: null, checked: true }] };
}

/** Ticks or unticks one feed. A sixth tick is refused. */
export function toggleFeed(
  current: readonly FeedChoice[],
  url: string,
  checked: boolean,
): FeedListChange {
  if (checked && tickedCount(current) >= MAX_COMPETITOR_FEEDS) {
    return { ok: false, problem: FEEDS_FULL };
  }
  return {
    ok: true,
    feeds: current.map((feed) => (feed.url === url ? { ...feed, checked } : feed)),
  };
}

/** `@acme.bsky.social` as people paste it, to the handle itself. */
function withoutAt(text: string): string {
  return text.trim().replace(/^@/, '');
}

/**
 * A host name the way the API reads one: dotted labels ending in letters. So a
 * handle or an instance the dialog passes is one the API takes.
 */
const HOST = '(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})';
const BLUESKY_HANDLE = new RegExp(`^${HOST}$`, 'i');
const MASTODON_ACCOUNT = new RegExp(`^[A-Za-z0-9_]{1,64}@${HOST}$`, 'i');

export type CompetitorField = 'name' | 'website' | 'youtube' | 'bluesky' | 'mastodon' | 'news';

/** What is wrong with the form, field by field. Empty when it can be sent. */
export function formProblems(form: CompetitorForm): Partial<Record<CompetitorField, string>> {
  const problems: Partial<Record<CompetitorField, string>> = {};

  if (!form.name.trim()) problems.name = NAME_NEEDED;

  if (form.website.trim() && !websiteAddress(form.website)) problems.website = WEBSITE_HINT;

  const youtube = form.youtube.trim();
  if (youtube && !/^UC[A-Za-z0-9_-]{22}$/.test(youtube)) problems.youtube = YOUTUBE_HINT;

  const bluesky = withoutAt(form.bluesky);
  if (bluesky && !BLUESKY_HANDLE.test(bluesky)) problems.bluesky = BLUESKY_HINT;

  const mastodon = withoutAt(form.mastodon);
  if (mastodon && !MASTODON_ACCOUNT.test(mastodon)) {
    problems.mastodon = MASTODON_HINT;
  }

  const news = newsPhrase(form).trim();
  const isOwnPhrase = news !== '' && news !== form.name.trim();
  if (isOwnPhrase && (news.length < NEWS_QUERY_MIN || news.length > NEWS_QUERY_MAX)) {
    problems.news = NEWS_LENGTH;
  }

  return problems;
}

/**
 * The body a save sends: the whole competitor, every optional field as its
 * value or null, the ticked feeds only. A search phrase that is empty or is
 * just the name goes as null, so the API searches for the name and a later
 * rename moves the search with it.
 */
export function competitorInput(form: CompetitorForm): CompetitorInput {
  const name = form.name.trim();
  const news = newsPhrase(form).trim();

  return {
    name,
    websiteUrl: form.website.trim() || null,
    feedUrls: form.feeds.filter((feed) => feed.checked).map((feed) => feed.url),
    youtubeChannelId: form.youtube.trim() || null,
    blueskyHandle: withoutAt(form.bluesky).toLowerCase() || null,
    mastodonAcct: withoutAt(form.mastodon) || null,
    newsQuery: news && news !== name ? news : null,
  };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * What an edit sends: only the fields that differ from what is saved. The API
 * looks every address it is sent up again, so sending them all would let one
 * old feed whose site has gone away refuse a change of name. Empty when nothing
 * changed, and then nothing is sent at all.
 */
export function competitorPatch(form: CompetitorForm, saved: Competitor): Partial<CompetitorInput> {
  const input = competitorInput(form);
  const patch: Partial<CompetitorInput> = {};

  if (input.name !== saved.name) patch.name = input.name;
  // The saved address is the API's spelling of it ("https://acme.com/"), which the field shows.
  if ((input.websiteUrl ?? null) !== saved.websiteUrl) patch.websiteUrl = input.websiteUrl;
  if (!sameList(input.feedUrls ?? [], saved.feedUrls)) patch.feedUrls = input.feedUrls;
  if ((input.youtubeChannelId ?? null) !== saved.youtubeChannelId) {
    patch.youtubeChannelId = input.youtubeChannelId;
  }
  if ((input.blueskyHandle ?? null) !== saved.blueskyHandle) {
    patch.blueskyHandle = input.blueskyHandle;
  }
  if ((input.mastodonAcct ?? null) !== saved.mastodonAcct) patch.mastodonAcct = input.mastodonAcct;
  if ((input.newsQuery ?? null) !== saved.newsQuery) patch.newsQuery = input.newsQuery;

  return patch;
}
