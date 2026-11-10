/**
 * Every sentence Discover's API can say. Names are Title Case and sentences are
 * sentences, as everywhere in the app; the words are the page's own: place, trend,
 * story. Never "locality", "feed" or "geocode".
 */
export const DISCOVER_MESSAGES = {
  localityThrottled: 'Try again in a moment.',
  geocoderOff: 'Finding places is turned off on this PostGear.',
  localityUnavailable: 'We could not find your location. Search for your city instead.',
  searchUnavailable: 'We could not look up places just now. Try again in a moment.',
  notFound: (query: string) => `No places found for '${query}'. Try the city's English name.`,

  feedThrottled: 'That is a lot of new places at once. Try again in a moment.',
  kindNotReady: 'Arrives in a later step of this sprint.',

  risingTitle: (place: string) => `Rising Searches In ${place}`,
  risingSubtitle: 'Via Google Trends.',
  placeTitle: (city: string) => `${city} Stories`,
  topTitle: (country: string) => `Top Stories In ${country}`,
  worldTitle: 'Top Stories Worldwide',
  newsSubtitle: 'Via Google News.',
  staleNote: (minutes: number) =>
    `Showing what we had from ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago.`,
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
