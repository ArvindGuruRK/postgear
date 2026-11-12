'use client';

/**
 * Sprint 11's Discover pieces, as the page uses them: the place chip in each
 * of its states, the language chip, the popover's body (with the blocked
 * warning), a trend card and a story card, Module 05's Wikipedia rows, social
 * chips, video cards and festival rows, Module 07's competitor rows, Module
 * 08's reader article, and the loading footprint. They are built from the design system (blueprint section
 * 11), so this section is where a change to one of those is checked against
 * Discover too.
 *
 * Module 06 adds the chip's Workspace badge, the popover's last part (the
 * workspace's saved place and Save For This Workspace, as an admin and as a
 * member see it) and the News tab's Topic select.
 *
 * The samples are made up, with Tamil and Arabic among them: outside text
 * arrives in any script, and a right-to-left title must still sit right.
 * Module 09 adds one story card and one row each in Tamil, Arabic and Japanese
 * (`discover-script-samples.ts`), all invented.
 */
import { useState } from 'react';
import { CardMenu } from '@/components/discover/card-menu';
import { CompetitorRows } from '@/components/discover/competitor-row';
import { DiscoverGroup, DiscoverSkeleton } from '@/components/discover/discover-group';
import { readerMeta } from '@/components/discover/discover-model';
import { INSET_NOTE } from '@/components/discover/discover-ui';
import { LanguageChip } from '@/components/discover/language-chip';
import { PlaceChip } from '@/components/discover/place-chip';
import {
  PlacePopover,
  WorkspaceDefault,
  type WorkspaceDefaultProps,
} from '@/components/discover/place-popover';
import { ReaderArticleBody } from '@/components/discover/reader-sheet';
import { TopicSelect } from '@/components/discover/topic-select';
import { LOCATION_MESSAGES } from '@/components/discover/use-place';
import { useMounted } from '@/components/posts/use-mounted';
import type {
  DiscoverItem,
  DiscoverSettings,
  DiscoverGroup as Group,
  Locality,
  NewsTopic,
} from '@/types/discover';
import { Row, Section, Spec } from '../shared';
import { SCRIPT_ROW_GROUP, SCRIPT_STORY_GROUP } from './discover-script-samples';

const INDIA: Locality = {
  countryCode: 'IN',
  countryName: 'India',
  regionCode: null,
  regionName: null,
  city: null,
  timeZone: 'Asia/Kolkata',
  languages: ['hi', 'en', 'ta'],
  newsLanguages: ['hi', 'en', 'ta'],
};

/** A made-up article, in Tamil and English, as the reader draws one. No picture: the playground loads nothing from outside. */
const READER_ARTICLE = {
  siteName: 'The Sample Courier',
  byline: 'A. Reporter',
  publishedAt: '2026-11-04T06:30:00.000Z',
  readMinutes: 3,
  image: null,
  text: [
    'The old harbour market opened its gates again on Wednesday morning, two years after a winter storm tore away most of its roof.',
    'கோயம்புத்தூர் மாவட்டத்தில் நேற்று இரவு முதல் கனமழை பெய்து வருகிறது. இதனால் நகரின் பல பகுதிகளில் சாலைகளில் தண்ணீர் தேங்கியுள்ளது.',
    'Sixty stalls have returned, a few more than the market held before it closed. Most of the old names are back, joined by a dozen newcomers.',
    'The market is open from Tuesday to Sunday, from seven in the morning until two in the afternoon.',
  ].join('\n\n'),
};

const CHENNAI: Locality = {
  ...INDIA,
  regionCode: 'IN-TN',
  regionName: 'Tamil Nadu',
  city: 'Chennai',
  languages: ['ta', 'en'],
  newsLanguages: ['ta', 'en'],
};

const WORLD: Locality = {
  countryCode: null,
  countryName: null,
  regionCode: null,
  regionName: null,
  city: null,
  timeZone: null,
  languages: ['en'],
  newsLanguages: ['en'],
};

/** A fixed clock, so the cards' times read the same on every load. */
const NOW = new Date('2026-11-10T12:00:00Z');

const DEMO_GROUP: Group = {
  id: 'trends',
  title: 'Rising Searches In Tamil Nadu',
  subtitle: 'Via Google Trends. Showing what we had from 25 minutes ago.',
  attribution: { name: 'Google Trends' },
  stale: true,
  fetchedAt: '2026-11-10T11:35:00Z',
  items: [
    {
      id: 'demo-trend',
      kind: 'trend',
      source: { id: 'google-trends', name: 'Google Trends' },
      title: 'weather coimbatore',
      url: 'https://example.com/rain',
      publishedAt: '2026-11-10T10:00:00Z',
      signal: { label: '500+ searches' },
      related: [
        {
          title: 'Heavy rain alert for Coimbatore',
          url: 'https://example.com/rain',
          source: 'The Hindu',
        },
        {
          title: 'Schools shut as rain continues',
          url: 'https://example.com/schools',
          source: 'Dinamalar',
        },
      ],
      brief: 'Rising search in Tamil Nadu.',
    },
    {
      id: 'demo-story',
      kind: 'news',
      source: { id: 'google-news', name: 'Nakkheeran' },
      title: 'சென்னையில் கனமழை எச்சரிக்கை',
      opaqueUrl: 'https://example.com/story',
      publishedAt: '2026-11-10T11:30:00Z',
      language: 'ta',
      brief: 'A Chennai story.',
    },
    {
      id: 'demo-rtl',
      kind: 'news',
      source: { id: 'google-news', name: 'Al Bayan' },
      title: 'أمطار غزيرة في دبي اليوم',
      opaqueUrl: 'https://example.com/rtl',
      publishedAt: '2026-11-10T09:00:00Z',
      language: 'ar',
      brief: 'A Dubai story.',
    },
  ],
};

/** The place's own date in the festival samples, so "in 5 days" reads the same on every load. */
const TODAY = '2026-11-10';

function wiki(id: string, title: string, label: string, language: string): DiscoverItem {
  return {
    id,
    kind: 'wiki',
    source: { id: 'wikipedia', name: 'Wikipedia', url: 'https://example.com/wiki' },
    title,
    url: `https://example.com/wiki/${id}`,
    language,
    signal: { label },
    brief: 'A widely read article.',
  };
}

const WIKIPEDIA_GROUP: Group = {
  id: 'wikipedia',
  title: 'What People Are Reading On Tamil Wikipedia',
  subtitle: "Yesterday's most-read articles. Wikipedia, text CC BY-SA.",
  attribution: { name: 'Wikipedia' },
  stale: false,
  fetchedAt: '2026-11-10T06:00:00Z',
  items: [
    wiki('demo-wiki-1', 'திருக்குறள்', '1,627 reads', 'ta'),
    wiki('demo-wiki-2', 'தீபாவளி', '1,204 reads', 'ta'),
    wiki('demo-wiki-3', 'اللغة العربية', '980 reads', 'ar'),
    wiki('demo-wiki-4', 'Ramayana: Part 1', '412 reads', 'en'),
  ],
};

function social(
  id: string,
  network: 'bluesky' | 'mastodon',
  title: string,
  label: string,
  linked = true,
): DiscoverItem {
  return {
    id,
    kind: 'social',
    source: { id: network, name: network === 'bluesky' ? 'Bluesky' : 'Mastodon' },
    title,
    ...(linked ? { url: `https://example.com/${network}/${id}` } : {}),
    signal: { label },
    brief: 'A worldwide topic.',
  };
}

const SOCIAL_GROUP: Group = {
  id: 'social',
  title: 'Worldwide On Bluesky And Mastodon',
  subtitle: 'Not local: what the whole network is talking about.',
  attribution: { name: 'Bluesky and Mastodon' },
  stale: false,
  fetchedAt: '2026-11-10T11:55:00Z',
  items: [
    social('demo-social-1', 'bluesky', 'House speaker picks', '4,625 posts'),
    social('demo-social-2', 'bluesky', 'كأس العالم', '2,310 posts'),
    social('demo-social-3', 'bluesky', 'A topic with no address', '118 posts', false),
    social('demo-social-4', 'mastodon', '#MeerMittwoch', '273 uses this week'),
    social('demo-social-5', 'mastodon', '#தமிழ்', '96 uses this week'),
  ],
};

const VIDEO_ITEMS: DiscoverItem[] = [
  {
    id: 'demo-video-1',
    kind: 'video',
    source: { id: 'youtube', name: 'YouTube', url: 'https://example.com/videos' },
    title: 'சென்னை மழை: இன்றைய நிலவரம்',
    summary: 'Chennai Live',
    url: 'https://example.com/videos/1',
    publishedAt: '2026-11-09T10:00:00Z',
    language: 'ta',
    signal: { label: '1.2M views', views: 1_200_000 },
    brief: 'A trending video in India.',
  },
  {
    id: 'demo-video-2',
    kind: 'video',
    source: { id: 'youtube', name: 'YouTube', url: 'https://example.com/videos' },
    title: 'How We Planned A Festival Campaign In One Week',
    summary: 'Marketing Notes',
    url: 'https://example.com/videos/2',
    publishedAt: '2026-11-07T08:00:00Z',
    signal: { label: '11K views', views: 11_000 },
    brief: 'A trending video in India.',
  },
];

function festival(date: string, title: string, observance: boolean): DiscoverItem {
  return {
    id: `demo-festival-${date}-${title}`,
    kind: 'festival',
    source: { id: 'holidays', name: 'Google Calendar' },
    title,
    date,
    observance,
    brief: 'A festival in India.',
  };
}

const FESTIVAL_GROUP: Group = {
  id: 'festivals',
  title: 'Festivals And Holidays In India',
  subtitle: 'Dates from public holiday calendars and date-holidays (CC BY-SA).',
  attribution: { name: 'Public holiday calendars and date-holidays' },
  stale: false,
  fetchedAt: '2026-11-10T02:00:00Z',
  items: [
    festival('2026-11-08', 'Diwali/Deepavali', false),
    festival('2026-11-09', 'Govardhan Puja', true),
    festival('2026-11-10', 'கந்த சஷ்டி', true),
    festival('2026-11-11', 'Bhai Duj', true),
    festival('2026-11-15', 'Chhat Puja (Pratihar Sashthi/Surya Sashthi)', true),
    festival('2026-11-18', 'اليوم الوطني', false),
    festival('2026-11-24', 'Guru Nanak Jayanti', false),
    festival('2026-12-03', 'கார்த்திகை தீபம்', true),
  ],
};

function competitorItem(
  id: string,
  source: DiscoverItem['source'],
  title: string,
  publishedAt: string,
  url?: string,
): DiscoverItem {
  return {
    id: `demo-competitor-${id}`,
    kind: 'competitor',
    source,
    title,
    publishedAt,
    ...(url ? { url } : {}),
    brief: `Acme Analytics published: '${title}'. Write our own take on this topic.`,
  };
}

/** One of each kind, newest first. The last has no address, so it has no Open. */
const COMPETITOR_ITEMS: DiscoverItem[] = [
  competitorItem(
    'blog',
    { id: 'rss', name: 'Acme Analytics Blog' },
    'Five ways to cut churn',
    '2026-11-10T09:00:00Z',
    'https://example.com/blog/five-ways-to-cut-churn',
  ),
  competitorItem(
    'youtube',
    { id: 'youtube', name: 'Acme Analytics' },
    'Reading a retention chart in four minutes',
    '2026-11-09T15:00:00Z',
    'https://example.com/watch',
  ),
  competitorItem(
    'bluesky',
    { id: 'bluesky', name: 'Bluesky' },
    'Scheduled reports are live. Pick a day, pick a time, and stop exporting by hand.',
    '2026-11-08T16:40:00Z',
    'https://example.com/profile/acme/post/1',
  ),
  competitorItem(
    'mastodon',
    { id: 'mastodon', name: 'Mastodon' },
    'نبحث عن مهندس دعم',
    '2026-11-06T09:00:00Z',
    'https://example.com/@acme/2',
  ),
  competitorItem(
    'news',
    { id: 'google-news', name: 'Sample Business Daily' },
    'Acme Analytics raises a round to build reporting tools',
    '2026-11-04T06:45:00Z',
  ),
];

const nothing = () => undefined;
const notFound = () => Promise.resolve(false);

/** What a workspace saved (Module 06): Chennai, Tamil then English, Business first. */
const SAVED: DiscoverSettings = {
  countryCode: 'IN',
  regionCode: 'IN-TN',
  regionName: 'Tamil Nadu',
  city: 'Chennai',
  timeZone: 'Asia/Kolkata',
  languages: ['ta', 'en'],
  topics: ['BUSINESS'],
  sources: null,
  interests: [],
  weeklyDigest: false,
  locationSource: 'SEARCH',
  place: CHENNAI,
  updatedAt: '2026-11-10T08:00:00.000Z',
};

const NOTHING_SAVED: DiscoverSettings = {
  ...SAVED,
  countryCode: null,
  regionCode: null,
  regionName: null,
  city: null,
  timeZone: null,
  languages: [],
  topics: [],
  locationSource: 'NONE',
  place: null,
  updatedAt: null,
};

/** The popover's last part for an admin with nothing going on; each specimen changes one thing. */
const WORKSPACE_ADMIN: Omit<WorkspaceDefaultProps, 'settings'> = {
  isAdmin: true,
  saving: false,
  error: null,
  onSave: nothing,
};

export function DiscoverSection() {
  // The sample thumbnail is the app's own icon, so the playground asks nothing
  // of the outside; a thumbnail needs a full address, known only in the browser.
  const mounted = useMounted();
  const [topic, setTopic] = useState<NewsTopic | null>('BUSINESS');
  const videoGroup: Group = {
    id: 'videos',
    title: 'Trending On YouTube In India',
    subtitle: 'Via YouTube.',
    attribution: { name: 'YouTube' },
    stale: false,
    fetchedAt: '2026-11-10T11:40:00Z',
    items: VIDEO_ITEMS.map((item, index) =>
      mounted && index === 0
        ? { ...item, image: `${window.location.origin}/brand/icon-512.png` }
        : item,
    ),
  };

  return (
    <Section
      title="Discover"
      description="The place and language chips, the place popover with the workspace's saved place, the Topic select, trend, story and video cards, Wikipedia rows, social chips, festival rows and the loading footprint from Sprint 11. Everything is a design-system piece; nothing here is drawn by hand."
    >
      <Row label="Place Chip (guess, found, the workspace's, Worldwide, finding)">
        <PlaceChip
          place={INDIA}
          source="guess"
          status="idle"
          message={null}
          geocoder="nominatim"
          onLocate={notFound}
          onPick={nothing}
          onWorldwide={nothing}
        />
        <PlaceChip
          place={CHENNAI}
          source="browser"
          status="idle"
          message={null}
          geocoder="nominatim"
          onLocate={notFound}
          onPick={nothing}
          onWorldwide={nothing}
        />
        <PlaceChip
          place={CHENNAI}
          source="workspace"
          status="idle"
          message={null}
          geocoder="nominatim"
          onLocate={notFound}
          onPick={nothing}
          onWorldwide={nothing}
          workspace={{ ...WORKSPACE_ADMIN, settings: SAVED }}
        />
        <PlaceChip
          place={WORLD}
          source="worldwide"
          status="idle"
          message={null}
          geocoder="nominatim"
          onLocate={notFound}
          onPick={nothing}
          onWorldwide={nothing}
        />
        <PlaceChip
          place={CHENNAI}
          source="browser"
          status="resolving"
          message={null}
          geocoder="nominatim"
          onLocate={notFound}
          onPick={nothing}
          onWorldwide={nothing}
        />
        <Spec>
          Popover trigger; h-10 rounded-lg border-2 bg-chrome; no shadow; FIELD_FOCUS; Guess and
          Workspace are Badge outline
        </Spec>
      </Row>

      <Row label="Language Chip">
        <LanguageChip languages={['ta', 'en']} value="ta" onChange={nothing} />
        <LanguageChip languages={['hi', 'en', 'ta']} value="en" onChange={nothing} />
        <Spec>Select, trigger dressed as the place chip; native name then English</Spec>
      </Row>

      <Row label="Place Popover (as it opens, and after the browser said no)">
        <div className="w-96 max-w-full rounded-lg border-2 border-outline bg-secondary p-4">
          <PlacePopover
            status="idle"
            message={null}
            geocoder="nominatim"
            onLocate={nothing}
            onPick={nothing}
            onWorldwide={nothing}
          />
        </div>
        <div className="w-96 max-w-full rounded-lg border-2 border-outline bg-secondary p-4">
          <PlacePopover
            status="denied"
            message={LOCATION_MESSAGES.denied}
            geocoder="nominatim"
            onLocate={nothing}
            onPick={nothing}
            onWorldwide={nothing}
          />
        </div>
      </Row>

      <Row label="Place Popover With The Workspace Place (an admin, and a member: hover the button)">
        <div className="w-96 max-w-full rounded-lg border-2 border-outline bg-secondary p-4">
          <PlacePopover
            status="idle"
            message={null}
            geocoder="nominatim"
            onLocate={nothing}
            onPick={nothing}
            onWorldwide={nothing}
            workspace={{ ...WORKSPACE_ADMIN, settings: SAVED }}
          />
        </div>
        <div className="w-96 max-w-full rounded-lg border-2 border-outline bg-secondary p-4">
          <PlacePopover
            status="idle"
            message={null}
            geocoder="nominatim"
            onLocate={nothing}
            onPick={nothing}
            onWorldwide={nothing}
            workspace={{ ...WORKSPACE_ADMIN, settings: SAVED, isAdmin: false }}
          />
        </div>
        <Spec>
          Under Worldwide, a border-t-2 line apart; Save For This Workspace is Button secondary; a
          member gets it disabled inside TooltipHint
        </Spec>
      </Row>

      <Row label="Workspace Place Footer (nothing saved yet, a refused save, saving, place finder off)">
        <div className="w-96 max-w-full rounded-lg border-2 border-outline bg-secondary p-4">
          <WorkspaceDefault {...WORKSPACE_ADMIN} settings={NOTHING_SAVED} />
        </div>
        <div className="w-96 max-w-full rounded-lg border-2 border-outline bg-secondary p-4">
          <WorkspaceDefault
            {...WORKSPACE_ADMIN}
            settings={SAVED}
            error="We could not save the workspace place. Try again in a moment."
          />
        </div>
        <div className="w-96 max-w-full rounded-lg border-2 border-outline bg-secondary p-4">
          <WorkspaceDefault {...WORKSPACE_ADMIN} settings={SAVED} saving />
        </div>
        <div className="w-96 max-w-full rounded-lg border-2 border-outline bg-secondary p-4">
          <PlacePopover
            status="idle"
            message={null}
            geocoder="off"
            onLocate={nothing}
            onPick={nothing}
            onWorldwide={nothing}
            workspace={{ ...WORKSPACE_ADMIN, settings: SAVED }}
          />
        </div>
        <Spec>A refused save is Alert danger with Try Again, never a hand-made tint</Spec>
      </Row>

      <Row label="Topic Select (the News tab)">
        <TopicSelect value={topic} onChange={setTopic} />
        <Spec>Select, trigger dressed as the language chip; All, then Google&apos;s order</Spec>
      </Row>

      <Row label="Trend And Story Cards In A Group">
        <div className="w-full">
          <DiscoverGroup
            group={DEMO_GROUP}
            now={NOW}
            onCreatePost={nothing}
            renderExtra={(item) => <CardMenu orgId="dev" item={item} />}
          />
        </div>
        <Spec>
          AnalyticsPanel + PanelHeader; cards bg-inset, dir=&quot;auto&quot; on feed text; Create
          Post secondary; overflow is a ghost icon button with Draft In Copilot
        </Spec>
      </Row>

      <Row label="Wikipedia Rows In A Group">
        <div className="w-full">
          <DiscoverGroup group={WIKIPEDIA_GROUP} now={NOW} onCreatePost={nothing} />
        </div>
        <Spec>
          ol, ROW_LIST (bg-inset, divide-y-2, no shadow); rank type-heading; title is a Link; reads
          type-muted; Create Post secondary sm; Open is an ActionLink
        </Spec>
      </Row>

      <Row label="Tamil, Arabic And Japanese (invented samples: one story card and one row each)">
        <div className="flex w-full flex-col gap-6">
          <DiscoverGroup
            group={SCRIPT_STORY_GROUP}
            now={NOW}
            onCreatePost={nothing}
            onRead={nothing}
          />
          <DiscoverGroup group={SCRIPT_ROW_GROUP} now={NOW} onCreatePost={nothing} />
        </div>
        <Spec>
          Titles carry dir=&quot;auto&quot;: Arabic reads right to left and sits on the right, Tamil
          and Japanese on the left; break-words wraps a headline with no spaces; buttons and
          badges stay left to right
        </Spec>
      </Row>

      <Row label="Social Chips In A Group (links out; the third has no address)">
        <div className="w-full">
          <DiscoverGroup group={SOCIAL_GROUP} now={NOW} />
        </div>
        <Spec>
          a, rounded-lg border-2 bg-secondary, no shadow; hover fills bg-actionSecondary; aria-label
          names the network
        </Spec>
      </Row>

      <Row label="Video Cards In A Group (with and without a thumbnail)">
        <div className="w-full">
          <DiscoverGroup
            group={videoGroup}
            now={NOW}
            onCreatePost={nothing}
            renderExtra={(item) => <CardMenu orgId="dev" item={item} />}
          />
        </div>
        <Spec>
          The trend card with a channel line (type-ui text-xs); thumbnail AspectRatio 16/9, lazy, no
          referrer, gone if it fails
        </Spec>
      </Row>

      <Row label="Festival Rows In A Group (both badges, past and coming; today is 10 Nov)">
        <div className="w-full">
          <DiscoverGroup group={FESTIVAL_GROUP} now={NOW} today={TODAY} onPlanPost={nothing} />
        </div>
        <Spec>
          Sections h3 type-label; ROW_LIST; date type-heading; Badge success (Public Holiday) or
          secondary (Observance); when type-muted; Plan A Post secondary sm
        </Spec>
      </Row>

      <Row label="Competitor Rows (one of each kind; the last has no address)">
        <div className="w-full">
          <CompetitorRows items={COMPETITOR_ITEMS} now={NOW} onCreatePost={nothing} />
        </div>
        <Spec>
          ul, ROW_LIST; Badge outline names the kind; title is a Link with dir=&quot;auto&quot;; a
          News row names its publisher in type-muted; Create Post secondary sm; Open is an
          ActionLink
        </Spec>
      </Row>

      <Row label="A Competitor With Nothing New">
        <div className="w-full">
          <p className={INSET_NOTE}>Nothing new from Acme Analytics in the last 30 days.</p>
        </div>
        <Spec>INSET_NOTE: rounded-lg border-2 bg-inset, type-muted, no shadow</Spec>
      </Row>

      <Row label="The Reader's Article (Module 08: the line over the title, then the text)">
        <div className="flex w-full max-w-xl flex-col gap-3">
          <p className="m-0 font-sans text-sm font-medium text-ink muted-tone">
            {readerMeta(READER_ARTICLE, 'UTC')}
          </p>
          <ReaderArticleBody article={READER_ARTICLE} className="max-h-72" />
        </div>
        <Spec>
          Meta joined with commas (never a middle dot); text is INSET (bg-inset), one p per
          paragraph with dir=&quot;auto&quot;, max-w-prose, text nodes only; the region scrolls and
          takes focus
        </Spec>
      </Row>

      <Row label="Loading">
        <div className="w-full">
          <DiscoverSkeleton />
        </div>
      </Row>
    </Section>
  );
}
