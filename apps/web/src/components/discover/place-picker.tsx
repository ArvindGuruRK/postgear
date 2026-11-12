'use client';

/**
 * Choosing a place from lists (Module 10, the Module 09 gap): a country, then
 * one of its regions or the whole country. For a PostGear with no place
 * finder, where typing a city cannot work, so a place is still more than
 * Worldwide.
 *
 * Both lists come from the API's own tables, never the network, so they load
 * fast and the same for everyone. The countries are asked once per page and
 * kept. A country with no region list (most of them) offers the whole country
 * alone.
 *
 * Use This Place asks the API for the whole place those two make (languages,
 * time zone, Google News editions), so a picked place reads exactly like a
 * searched one.
 */
import { Alert, Button, Combobox, Skeleton } from '@postgear/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { getCountries, getPickedLocality, getRegions } from '@/lib/discover-api';
import type { Locality, PlaceOption } from '@/types/discover';

export const PICKER_FAILED = 'The list of places could not load. Try again in a moment.';
export const PICK_FAILED = 'That place could not be used. Try again in a moment.';

/** The region choice that means the whole country. Never a real region code. */
const WHOLE_COUNTRY = '*';

// The countries never change while the page is open.
let countriesCache: PlaceOption[] | null = null;

function sentenceOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError && cause.status !== 0 && cause.status < 500
    ? cause.message
    : fallback;
}

export interface PlacePickerProps {
  onPick: (place: Locality) => void;
  disabled?: boolean;
}

export function PlacePicker({ onPick, disabled = false }: PlacePickerProps) {
  const countryId = useId();
  const regionId = useId();
  const [countries, setCountries] = useState<PlaceOption[] | null>(countriesCache);
  const [country, setCountry] = useState('');
  const [regions, setRegions] = useState<PlaceOption[] | null>(null);
  const [region, setRegion] = useState(WHOLE_COUNTRY);
  const [problem, setProblem] = useState<string | null>(null);
  const [using, setUsing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const latestRegions = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the Try Again trigger
  useEffect(() => {
    if (countriesCache) return;
    let live = true;
    getCountries()
      .then((list) => {
        countriesCache = list;
        if (live) setCountries(list);
      })
      .catch((cause: unknown) => {
        if (live) setProblem(sentenceOf(cause, PICKER_FAILED));
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  function chooseCountry(code: string) {
    setCountry(code);
    setRegion(WHOLE_COUNTRY);
    setRegions(null);
    setProblem(null);
    const request = ++latestRegions.current;
    getRegions(code)
      .then((list) => {
        if (request === latestRegions.current) setRegions(list);
      })
      .catch(() => {
        // Without its regions the country still works on its own.
        if (request === latestRegions.current) setRegions([]);
      });
  }

  async function use() {
    if (!country || using || disabled) return;
    setUsing(true);
    setProblem(null);
    try {
      onPick(await getPickedLocality(country, region === WHOLE_COUNTRY ? null : region));
    } catch (cause) {
      setProblem(sentenceOf(cause, PICK_FAILED));
    } finally {
      setUsing(false);
    }
  }

  if (!countries) {
    return problem ? (
      <Alert variant="warning" className="items-center px-3 py-2 text-xs">
        <span className="flex-1">{problem}</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setProblem(null);
            setAttempt((count) => count + 1);
          }}
        >
          Try Again
        </Button>
      </Alert>
    ) : (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-11 w-full rounded-md" />
        <Skeleton className="h-11 w-full rounded-md" />
      </div>
    );
  }

  const regionOptions = [
    { value: WHOLE_COUNTRY, label: 'Whole country' },
    ...(regions ?? []).map((option) => ({ value: option.code, label: option.name })),
  ];

  return (
    <div className="flex flex-col gap-3" data-testid="discover-place-picker">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={countryId} className="font-sans text-sm font-bold text-ink">
          Country
        </label>
        <Combobox
          id={countryId}
          options={countries.map((option) => ({ value: option.code, label: option.name }))}
          value={country}
          onValueChange={chooseCountry}
          placeholder="Choose a country"
          searchPlaceholder="Enter your country"
          emptyText="No country by that name."
          disabled={disabled}
        />
      </div>
      {country && regions && regions.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={regionId} className="font-sans text-sm font-bold text-ink">
            Region
          </label>
          <Combobox
            id={regionId}
            options={regionOptions}
            value={region}
            onValueChange={setRegion}
            placeholder="Whole country"
            searchPlaceholder="Enter your region"
            emptyText="No region by that name."
            disabled={disabled}
          />
        </div>
      ) : null}
      {problem ? (
        <Alert variant="warning" className="px-3 py-2 text-xs">
          {problem}
        </Alert>
      ) : null}
      <Button
        variant="secondary"
        onClick={() => void use()}
        disabled={!country || using || disabled}
        aria-busy={using}
        className="self-start"
      >
        {using ? 'Using This Place…' : 'Use This Place'}
      </Button>
    </div>
  );
}
