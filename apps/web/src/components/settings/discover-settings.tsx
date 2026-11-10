'use client';

/**
 * Settings, Discover (Sprint 11, Module 06): what a workspace saves for
 * Discover. Four cards, each saved as it is changed: the place a first visit
 * starts from, the languages in order, the News topics, and which groups are
 * on.
 *
 * It follows the notification preferences: every change is optimistic (the
 * card moves at once) and reverted if the save fails, with the failure in one
 * alert whose Try Again repeats the same change. The server page passes what
 * it loaded; when it could not (`initial` is null) the island loads for
 * itself, and the same alert covers that failure with a retry of the load.
 *
 * Each save is one request carrying only its own card: a place whole (so a
 * new city never keeps the old region) together with that place's languages,
 * the language list, the topic list, or all five switches.
 *
 * Only a workspace admin can change any of it. A member reads the same page
 * with every control disabled and one line saying why, and nothing here sends
 * a save for them (the API would refuse it anyway).
 *
 * The place card draws the popover's own `PlaceFinder`, so Use My Location,
 * the city search and Worldwide behave here exactly as they do on the page.
 */
import { ArrowDownIcon } from '@animateicons/react/lucide/arrow-down-icon';
import { ArrowUpIcon } from '@animateicons/react/lucide/arrow-up-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Label,
  MotionIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Stack,
  Toggle,
  toast,
} from '@postgear/ui';
import { MapPin } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { getDiscoverSettings, saveDiscoverSettings } from '@/lib/discover-api';
import type {
  DiscoverSettings,
  DiscoverSettingsPatch,
  DiscoverSourceSwitch,
  Locality,
  NewsTopic,
} from '@/types/discover';
import { NEWS_TOPICS } from '@/types/discover';
import {
  NO_WORKSPACE_DEFAULT,
  placePatch,
  placeResultText,
  TOPIC_NAMES,
  WORLDWIDE_PLACE,
  workspaceLanguages,
} from '../discover/discover-model';
import { PlacesCredit, ROW, ROW_LIST } from '../discover/discover-ui';
import { languageLabel, languageName } from '../discover/language-names';
import { PlaceFinder } from '../discover/place-popover';
import { findBrowserPlace, type PlaceStatus } from '../discover/use-place';
import {
  addableLanguages,
  addLanguageHelp,
  LANGUAGES_EMPTY,
  languagesMoved,
  languagesWith,
  languagesWithout,
  LOAD_FAILED,
  READ_ONLY_NOTICE,
  SAVE_FAILED,
  SOURCE_FIELDS,
  sourceOn,
  sourcesWith,
  topicsWith,
} from './discover-settings-model';

/** The card a save belongs to, so that card can say it is busy. */
type CardId = 'place' | 'languages' | 'topics' | 'sources';

function describe(cause: unknown, fallback: string): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : fallback;
}

export interface DiscoverSettingsFormProps {
  /** Null when the server page could not load them; the island then loads for itself. */
  initial: DiscoverSettings | null;
  /** Presentation only: a member reads the page with every control disabled. The API's guard is the real check. */
  isAdmin: boolean;
  /** `off` leaves only Worldwide in the place card: this PostGear cannot look a city up. */
  geocoder: 'nominatim' | 'off';
}

export function DiscoverSettingsForm({ initial, isAdmin, geocoder }: DiscoverSettingsFormProps) {
  const ids = useId();
  const [settings, setSettings] = useState<DiscoverSettings | null>(initial);
  const [saving, setSaving] = useState<CardId | null>(null);
  const [loading, setLoading] = useState(initial === null);
  const [error, setError] = useState<string | null>(null);
  const retry = useRef<(() => Promise<void>) | null>(null);
  // What is on screen now, for a save that starts after a wait (the browser
  // finding a position, or Try Again): it must put back this, not an old copy.
  const shown = useRef(settings);
  shown.current = settings;
  // Use My Location, as the place popover tracks it.
  const [locating, setLocating] = useState<PlaceStatus>('idle');
  const [locateMessage, setLocateMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSettings(await getDiscoverSettings());
      setError(null);
      retry.current = null;
    } catch (cause) {
      setError(describe(cause, LOAD_FAILED));
      retry.current = load;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initial === null) {
      void load();
    }
  }, [initial, load]);

  /**
   * One card's save: show `next` at once, send `patch`, keep the API's
   * answer, and put everything back if it is refused.
   */
  const save = useCallback(
    async (
      card: CardId,
      patch: DiscoverSettingsPatch,
      next: (previous: DiscoverSettings) => DiscoverSettings,
      saved: string,
    ) => {
      // A member never sends a save, whatever reached this function.
      const previous = shown.current;
      if (!isAdmin || !previous) {
        return;
      }
      setSettings(next(previous));
      setSaving(card);

      try {
        setSettings(await saveDiscoverSettings(patch));
        setError(null);
        retry.current = null;
        toast({ title: 'Saved', description: saved });
      } catch (cause) {
        setSettings(previous);
        setError(describe(cause, SAVE_FAILED));
        retry.current = () => save(card, patch, next, saved);
      } finally {
        setSaving(null);
      }
    },
    [isAdmin],
  );

  // One change at a time: while a save is out, or the browser is finding a
  // position to save, every control waits.
  const busy = loading || saving !== null || locating === 'resolving';
  const locked = !isAdmin || busy;

  /** A new place is saved whole, with its own languages: the old place's would not fit it. */
  function savePlace(place: Locality, found: 'BROWSER' | 'SEARCH') {
    const patch = { ...placePatch(place, found), languages: workspaceLanguages(place) };
    void save(
      'place',
      patch,
      (previous) => ({ ...previous, ...patch, place }),
      `${placeResultText(place)} is now the workspace default.`,
    );
  }

  function clearPlace() {
    const patch = placePatch(null, 'NONE');
    void save(
      'place',
      patch,
      (previous) => ({ ...previous, ...patch, place: null }),
      'This workspace has no default place now.',
    );
  }

  async function locate() {
    if (locked) return;
    setLocateMessage(null);
    const answer = await findBrowserPlace(() => setLocating('resolving'));
    if (!answer.found) {
      setLocating(answer.status);
      setLocateMessage(answer.message);
      return;
    }
    setLocating('idle');
    savePlace(answer.place, 'BROWSER');
  }

  function pickPlace(place: Locality) {
    setLocating('idle');
    setLocateMessage(null);
    savePlace(place, 'SEARCH');
  }

  function saveLanguages(languages: string[]) {
    void save(
      'languages',
      { languages },
      (previous) => ({ ...previous, languages }),
      'Languages updated for this workspace.',
    );
  }

  function saveTopic(topic: NewsTopic, ticked: boolean) {
    if (!settings) return;
    const topics = topicsWith(settings.topics, topic, ticked);
    void save(
      'topics',
      { topics },
      (previous) => ({ ...previous, topics }),
      'News topics updated for this workspace.',
    );
  }

  function saveSource(key: DiscoverSourceSwitch, label: string, on: boolean) {
    if (!settings) return;
    const sources = sourcesWith(settings.sources, key, on);
    void save(
      'sources',
      { sources },
      (previous) => ({ ...previous, sources }),
      `${label} turned ${on ? 'on' : 'off'} for this workspace.`,
    );
  }

  const languages = settings?.languages ?? [];
  const addable = settings ? addableLanguages(languages, settings.place) : [];
  const addHelp = settings ? addLanguageHelp(languages, settings.place) : null;
  const addId = `${ids}-add-language`;

  return (
    <Stack gap="lg">
      {isAdmin ? null : (
        <Alert variant="info" data-testid="discover-settings-read-only">
          {READ_ONLY_NOTICE}
        </Alert>
      )}

      {error && (
        <Alert variant="danger" data-testid="discover-settings-error">
          <div className="flex flex-1 flex-col gap-1">
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void retry.current?.()}
            disabled={busy}
          >
            Try Again
          </Button>
        </Alert>
      )}

      <Card data-testid="discover-settings-place" aria-busy={saving === 'place' || undefined}>
        <CardHeader>
          <CardTitle>Workspace Place</CardTitle>
          <CardDescription>
            Where Discover starts for everyone in this workspace. A place someone chooses for
            themselves stays on their own device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settings ? (
            <Stack gap="md">
              <div className="flex flex-wrap items-center gap-3">
                <p
                  className="m-0 flex min-w-0 flex-1 items-center gap-2 rounded-lg border-2 border-outline bg-inset px-3 py-2 font-sans text-sm text-ink"
                  data-testid="discover-settings-place-text"
                >
                  <MapPin className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
                  <span className="min-w-0 truncate">
                    {settings.place ? placeResultText(settings.place) : NO_WORKSPACE_DEFAULT}
                  </span>
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={clearPlace}
                  disabled={locked || settings.place === null}
                >
                  Clear
                </Button>
              </div>
              <PlaceFinder
                status={locating}
                message={locateMessage}
                geocoder={geocoder}
                onLocate={() => void locate()}
                onPick={pickPlace}
                onWorldwide={() => pickPlace(WORLDWIDE_PLACE)}
                disabled={locked}
              />
              {geocoder === 'off' ? null : <PlacesCredit />}
            </Stack>
          ) : (
            <Skeleton className="h-40 w-full rounded-lg" />
          )}
        </CardContent>
      </Card>

      <Card
        data-testid="discover-settings-languages"
        aria-busy={saving === 'languages' || undefined}
      >
        <CardHeader>
          <CardTitle>Languages</CardTitle>
          <CardDescription>
            Discover opens in the first language when the place offers it. Everyone can still switch
            on the page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settings ? (
            <Stack gap="md">
              {languages.length === 0 ? (
                <p className="m-0 font-sans text-sm text-ink type-muted">{LANGUAGES_EMPTY}</p>
              ) : (
                <ol className={ROW_LIST} aria-label="Workspace languages">
                  {languages.map((code, index) => {
                    const name = languageName(code).english;
                    return (
                      <li key={code} className={ROW} data-testid="discover-settings-language">
                        <span className="w-5 shrink-0 type-heading text-base text-ink">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 font-sans text-sm text-ink">
                          {languageLabel(code)}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-9 px-0"
                            aria-label={`Move ${name} up`}
                            disabled={locked || index === 0}
                            onClick={() => saveLanguages(languagesMoved(languages, code, -1))}
                          >
                            <MotionIcon icon={ArrowUpIcon} className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-9 px-0"
                            aria-label={`Move ${name} down`}
                            disabled={locked || index === languages.length - 1}
                            onClick={() => saveLanguages(languagesMoved(languages, code, 1))}
                          >
                            <MotionIcon icon={ArrowDownIcon} className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-9 px-0"
                            aria-label={`Remove ${name}`}
                            disabled={locked}
                            onClick={() => saveLanguages(languagesWithout(languages, code))}
                          >
                            <MotionIcon icon={XIcon} className="h-4 w-4" />
                          </Button>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor={addId}>Add a language</Label>
                <Select
                  // Always empty: the select is a way to add, not a value to hold.
                  value=""
                  onValueChange={(code) => saveLanguages(languagesWith(languages, code))}
                  disabled={locked || addable.length === 0}
                >
                  <SelectTrigger
                    id={addId}
                    className="sm:w-72"
                    data-testid="discover-settings-add-language"
                  >
                    <SelectValue placeholder="Choose a language" />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {addable.map((code) => (
                      <SelectItem key={code} value={code}>
                        {languageLabel(code)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {addHelp ? (
                  <p className="m-0 font-sans text-xs text-ink type-muted">{addHelp}</p>
                ) : null}
              </div>
            </Stack>
          ) : (
            <Skeleton className="h-28 w-full rounded-lg" />
          )}
        </CardContent>
      </Card>

      <Card data-testid="discover-settings-topics" aria-busy={saving === 'topics' || undefined}>
        <CardHeader>
          <CardTitle>News Topics</CardTitle>
          <CardDescription>
            The News tab opens on the first topic ticked here, top to bottom. With none ticked it
            opens on All.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settings ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {NEWS_TOPICS.map((topic) => {
                const id = `${ids}-topic-${topic}`;
                return (
                  <div key={topic} className="flex items-center gap-3">
                    <Checkbox
                      id={id}
                      checked={settings.topics.includes(topic)}
                      disabled={locked}
                      onCheckedChange={(ticked) => saveTopic(topic, ticked === true)}
                    />
                    <Label htmlFor={id}>{TOPIC_NAMES[topic]}</Label>
                  </div>
                );
              })}
            </div>
          ) : (
            <Skeleton className="h-28 w-full rounded-lg" />
          )}
        </CardContent>
      </Card>

      <Card data-testid="discover-settings-sources" aria-busy={saving === 'sources' || undefined}>
        <CardHeader>
          <CardTitle>Sources</CardTitle>
          <CardDescription>
            Turn off what this workspace does not need. A group that is off is hidden for everyone
            here and is never fetched. News is always on.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Stack gap="md">
            {SOURCE_FIELDS.map((field) => {
              const id = `${ids}-source-${field.key}`;
              return (
                <div
                  key={field.key}
                  className="flex items-start justify-between gap-6 border-t-2 border-outline pt-4 first:border-t-0 first:pt-0"
                >
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={id}>{field.label}</Label>
                    <p className="m-0 font-sans text-xs text-ink type-muted">{field.help}</p>
                  </div>
                  {settings ? (
                    <Toggle
                      id={id}
                      checked={sourceOn(settings.sources, field.key)}
                      disabled={locked}
                      data-testid={`discover-settings-source-${field.key}`}
                      onCheckedChange={(on) => saveSource(field.key, field.label, on)}
                    />
                  ) : (
                    <Skeleton className="h-7 w-12 shrink-0 rounded-full" />
                  )}
                </div>
              );
            })}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
