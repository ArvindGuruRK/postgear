/**
 * Every sentence Discover's API can say. Names are Title Case and sentences are
 * sentences, as everywhere in the app; the words are the page's own: place, trend,
 * story, festival. Never "locality", "feed" or "geocode".
 */

const HOUR_MINUTES = 60;
const DAY_MINUTES = 24 * HOUR_MINUTES;

/**
 * "21 minutes", "5 hours", "8 days": the unit that reads best for the age. A
 * Trending copy is minutes old, a festival list can be a week old, and "10,080
 * minutes ago" tells nobody anything.
 */
function ageInWords(minutes: number): string {
  const [count, unit] =
    minutes < 2 * HOUR_MINUTES
      ? [minutes, 'minute']
      : minutes < 2 * DAY_MINUTES
        ? [Math.floor(minutes / HOUR_MINUTES), 'hour']
        : [Math.floor(minutes / DAY_MINUTES), 'day'];
  return `${count} ${count === 1 ? unit : `${unit}s`}`;
}

export const DISCOVER_MESSAGES = {
  localityThrottled: 'Try again in a moment.',
  geocoderOff: 'Finding places is turned off on this PostGear.',
  localityUnavailable: 'We could not find your location. Search for your city instead.',
  searchUnavailable: 'We could not look up places just now. Try again in a moment.',
  notFound: (query: string) => `No places found for '${query}'. Try the city's English name.`,

  feedThrottled: 'That is a lot of new places at once. Try again in a moment.',

  /** What a member is told on trying to save any of the workspace's Discover settings. */
  settingsAdminOnly: 'Only workspace admins can change the workspace place.',

  risingTitle: (place: string) => `Rising Searches In ${place}`,
  risingSubtitle: 'Via Google Trends.',
  placeTitle: (city: string) => `${city} Stories`,
  topTitle: (country: string) => `Top Stories In ${country}`,
  worldTitle: 'Top Stories Worldwide',
  newsSubtitle: 'Via Google News.',

  /** `language` is its English name ("Tamil"), or null when it has none we can say. */
  wikipediaTitle: (language: string | null) =>
    language
      ? `What People Are Reading On ${language} Wikipedia`
      : 'What People Are Reading On Wikipedia',
  wikipediaYesterday: "Yesterday's most-read articles. Wikipedia, text CC BY-SA.",
  /** `day` reads "8 November": the list is older than yesterday, and says so. */
  wikipediaOlder: (day: string) => `The most-read articles from ${day}. Wikipedia, text CC BY-SA.`,
  /** Only for a copy that does not say which day it is for. */
  wikipediaUndated: 'The most-read articles. Wikipedia, text CC BY-SA.',

  /** "Worldwide On Bluesky And Mastodon", or the one of them that has something to show. */
  socialTitle: (networks: readonly string[]) => `Worldwide On ${networks.join(' And ')}`,
  socialSubtitle: 'Not local: what the whole network is talking about.',
  socialAttribution: (networks: readonly string[]) => networks.join(' and '),

  videosTitle: (country: string) => `Trending On YouTube In ${country}`,
  videosSubtitle: 'Via YouTube.',
  videosResting: 'YouTube is resting until tomorrow. Showing what we had.',

  festivalsTitle: (country: string) => `Festivals And Holidays In ${country}`,
  festivalsSubtitle: 'Dates from public holiday calendars and date-holidays (CC BY-SA).',

  staleNote: (minutes: number) => `Showing what we had from ${ageInWords(minutes)} ago.`,
} as const;

/** The networks of the Worldwide group, by the name each is shown under. */
export const SOCIAL_NETWORKS = {
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
} as const;

/** The heading of a topic's group, by the name Google News gives the topic. */
export const TOPIC_TITLES = {
  WORLD: 'World Stories',
  NATION: 'National Stories',
  BUSINESS: 'Business Stories',
  TECHNOLOGY: 'Technology Stories',
  ENTERTAINMENT: 'Entertainment Stories',
  SPORTS: 'Sports Stories',
  SCIENCE: 'Science Stories',
  HEALTH: 'Health Stories',
} as const;
