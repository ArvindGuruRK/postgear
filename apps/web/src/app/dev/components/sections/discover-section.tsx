'use client';

/**
 * Sprint 11's Discover pieces, as the page uses them: the place chip in each
 * of its states, the language chip, the popover's body (with the blocked
 * warning), a trend card and a story card, and the loading footprint. They are
 * built from the design system (blueprint section 11), so this section is
 * where a change to one of those is checked against Discover too.
 */
import { CardMenu } from '@/components/discover/card-menu';
import { DiscoverGroup, DiscoverSkeleton } from '@/components/discover/discover-group';
import { LanguageChip } from '@/components/discover/language-chip';
import { PlaceChip } from '@/components/discover/place-chip';
import { PlacePopover } from '@/components/discover/place-popover';
import { LOCATION_MESSAGES } from '@/components/discover/use-place';
import type { DiscoverGroup as Group, Locality } from '@/types/discover';
import { Row, Section, Spec } from '../shared';

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

const nothing = () => undefined;
const notFound = () => Promise.resolve(false);

export function DiscoverSection() {
  return (
    <Section
      title="Discover"
      description="The place and language chips, the place popover, trend and story cards and the loading footprint from Sprint 11. Everything is a design-system piece; nothing here is drawn by hand."
    >
      <Row label="Place Chip (guess, found, Worldwide, finding)">
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
        <Spec>Popover trigger; h-10 rounded-lg border-2 bg-chrome; no shadow; FIELD_FOCUS</Spec>
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

      <Row label="Loading">
        <div className="w-full">
          <DiscoverSkeleton />
        </div>
      </Row>
    </Section>
  );
}
