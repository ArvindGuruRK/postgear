/**
 * The geocoder `DISCOVER_SIMULATION` uses: the three places the fixtures were
 * recorded for, and Worldwide everywhere else. It lets the place flow run with no
 * network, in Playwright and in hand checks.
 */
import type { Geocoder, Locality } from '../../types';
import { buildLocality, localityFromTimeZone, WORLDWIDE } from '../locality';

const NEARBY_KM = 50;
const EARTH_RADIUS_KM = 6_371;

export const CHENNAI: Locality = buildLocality({
  countryCode: 'IN',
  regionCode: 'IN-TN',
  regionName: 'Tamil Nadu',
  city: 'Chennai',
  timeZone: 'Asia/Kolkata',
});

export const SAN_FRANCISCO: Locality = buildLocality({
  countryCode: 'US',
  regionCode: 'US-CA',
  regionName: 'California',
  city: 'San Francisco',
  timeZone: 'America/Los_Angeles',
});

/**
 * The region is a real ISO code that Google Trends does not know (it files France
 * under older codes), so simulated Trending for Paris falls back to `FR` as the
 * real thing would.
 */
export const PARIS: Locality = buildLocality({
  countryCode: 'FR',
  regionCode: 'FR-IDF',
  regionName: 'Ile-de-France',
  city: 'Paris',
  timeZone: 'Europe/Paris',
});

const PLACES: ReadonlyArray<{ lat: number; lng: number; place: Locality }> = [
  { lat: 13.08, lng: 80.27, place: CHENNAI },
  { lat: 37.77, lng: -122.42, place: SAN_FRANCISCO },
  { lat: 48.86, lng: 2.35, place: PARIS },
];

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance. Good enough to say "near Chennai". */
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export function createSimulatedGeocoder(): Geocoder {
  return {
    reverse: async (lat, lng) => {
      const near = PLACES.find((entry) => distanceKm(lat, lng, entry.lat, entry.lng) <= NEARBY_KM);
      return { ...(near?.place ?? WORLDWIDE) };
    },

    search: async (text) => {
      const wanted = text.trim().toLowerCase();
      if (wanted === '') return [];
      return PLACES.map((entry) => entry.place)
        .filter((place) => place.city?.toLowerCase().includes(wanted))
        .map((place) => ({ ...place }));
    },

    fromTimeZone: localityFromTimeZone,
  };
}
