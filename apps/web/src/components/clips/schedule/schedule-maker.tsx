'use client';

/**
 * The Schedule Maker (Sprint 13, Module 14 section C4): a week of streams as
 * a picture, made as an ordinary Design Studio design. Desktop only, like
 * every Clips screen; reached from Creator Tools.
 *
 * 1. **Your Week**: a Twitch name (the From Twitch tab) or seven rows typed
 *    by hand (Fill It In By Hand, for Kick and YouTube people, who have no
 *    schedule we can read). Try A Sample fills the rows with a sample week,
 *    with no call. The zone is the browser's until changed from the list;
 *    nothing is guessed from the broadcaster.
 * 2. **Choose A Look**: Portrait or Landscape, and five theme cards, each the
 *    real renderer drawing the person's own week.
 * 3. **Open In Design Studio**: `POST /studio/designs` with the template and
 *    the rows, then the editor, where every word can be changed.
 *
 * A zone or clock change after a read reworks the rows in the browser from
 * the same answer: no second call. A week or name change forgets the answer.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { CalendarDaysIcon } from '@animateicons/react/lucide/calendar-days-icon';
import { type ScheduleRow, twitchLogin, withClock } from '@postgear/design-engine';
import {
  Alert,
  AlertDescription,
  Button,
  ChoiceTiles,
  cn,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  MotionIcon,
  PageActions,
  pressSm,
  Segmented,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@postgear/ui';
import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ActionLink } from '@/components/home/home-actions';
import { FOCUS } from '@/components/studio/design-card';
import { useChosenRing } from '@/components/studio/panel-ui';
import {
  browserZone,
  CLOCK_OPTIONS,
  type ClockChoice,
  clockChoiceOf,
  fetchFailureMessage,
  NO_SCHEDULE_NOTE,
  weekOptions,
  withRowField,
  withRowOff,
} from '@/components/studio/schedule-field-model';
import { ScheduleRowsTable } from '@/components/studio/schedule-rows-table';
import { ScheduleZoneSelect } from '@/components/studio/schedule-zone-select';
import { SlideFrame } from '@/components/studio/slide-frame';
import { INSET } from '@/components/studio/studio-ui';
import { ApiError, api } from '@/lib/api';
import type { DesignDetail } from '@/types/studio';
import type { ScheduleAnswer, ScheduleFetchBody } from '@/types/studio-schedules';
import {
  blankWeek,
  createDesignBody,
  MAKER_FORMATS,
  MAKER_TAB_NAMES,
  MAKER_THEMES,
  type MakerFormat,
  type MakerTab,
  type MakerWeek,
  makerWeek,
  previewDocument,
  sampleWeek,
} from './schedule-maker-model';

const ICON = 'h-4 w-4';

export function ScheduleMaker({ orgId }: { orgId: string }) {
  const router = useRouter();
  const nameId = useId();
  const nameHintId = useId();
  const zoneId = useId();
  const weekId = useId();
  const clockId = useId();
  const formatId = useId();
  const looksId = useId();

  const [tab, setTab] = useState<MakerTab>('twitch');
  const [name, setName] = useState('');
  // The browser's zone and this week are read after the first paint, so the
  // server's render (in the server's zone) never disagrees with the browser's.
  const [timeZone, setTimeZone] = useState('UTC');
  const [weekStart, setWeekStart] = useState('');
  const [hour12, setHour12] = useState(true);
  const [answer, setAnswer] = useState<ScheduleAnswer | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [handRows, setHandRows] = useState<ScheduleRow[]>(blankWeek);
  const [format, setFormat] = useState<MakerFormat>('portrait');
  const [themeId, setThemeId] = useState(MAKER_THEMES[0]?.id ?? '');
  const [opening, setOpening] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const zone = browserZone();
    setTimeZone(zone);
    setWeekStart(weekOptions(new Date(), zone)[0].value);
  }, []);
  useEffect(() => () => abort.current?.abort(), []);

  const weeks = useMemo(() => weekOptions(new Date(), timeZone), [timeZone]);
  const login = twitchLogin(name);
  const week = useMemo(
    () => makerWeek({ tab, timeZone, weekStart, hour12, answer, handRows }),
    [tab, timeZone, weekStart, hour12, answer, handRows],
  );
  const chosen = MAKER_THEMES.find((theme) => theme.id === themeId) ?? MAKER_THEMES[0];

  async function read() {
    if (!login || !weekStart || reading) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setReading(true);
    setReadError(null);
    try {
      const body: ScheduleFetchBody = { login, timeZone, weekStart };
      const result = await api<ScheduleAnswer>('/studio/schedules/fetch', {
        method: 'POST',
        body,
        signal: controller.signal,
      });
      setAnswer(result);
      if (result.weekStart !== weekStart) setWeekStart(result.weekStart);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setAnswer(null);
        setReadError(fetchFailureMessage(cause));
      }
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setReading(false);
      }
    }
  }

  function changeClock(choice: ClockChoice) {
    const next = choice === '12';
    setHour12(next);
    // Typed rows keep their words: only the times are rewritten.
    setHandRows((rows) => withClock(rows, next));
  }

  async function open() {
    if (!week.ready || !chosen || opening) return;
    setOpening(true);
    try {
      const { design } = await api<{ design: DesignDetail }>('/studio/designs', {
        method: 'POST',
        body: createDesignBody(chosen.presetId, format, week),
      });
      router.push(`/${encodeURIComponent(orgId)}/studio/${encodeURIComponent(design.id)}`);
    } catch (cause) {
      setOpening(false);
      toast({
        variant: 'danger',
        title: "Couldn't open the design",
        description: cause instanceof ApiError ? cause.message : 'Please try again.',
      });
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid="schedule-maker">
      <PageActions className="justify-start">
        <ActionLink href={`/${encodeURIComponent(orgId)}/clips/tools`} data-testid="schedule-back">
          <MotionIcon icon={ArrowLeftIcon} className={ICON} />
          Back To Creator Tools
        </ActionLink>
      </PageActions>

      <div className="grid grid-cols-[minmax(0,26rem)_minmax(0,1fr)] items-start gap-6">
        <section aria-labelledby="schedule-week" className="flex flex-col gap-5">
          <h2 id="schedule-week" className="m-0 type-heading text-lg text-ink">
            Your Week
          </h2>

          <Tabs value={tab} onValueChange={(value) => setTab(value as MakerTab)}>
            <TabsList aria-label="Where the week comes from">
              {(Object.keys(MAKER_TAB_NAMES) as MakerTab[]).map((value) => (
                <TabsTrigger key={value} value={value}>
                  {MAKER_TAB_NAMES[value]}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="twitch" className="mt-4 flex flex-col gap-4">
              <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void read();
                }}
              >
                <FormField>
                  <FormLabel htmlFor={nameId}>Twitch name</FormLabel>
                  <Input
                    id={nameId}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setAnswer(null);
                      setReadError(null);
                    }}
                    placeholder="Enter your Twitch name"
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby={nameHintId}
                    aria-invalid={name.trim() !== '' && !login ? true : undefined}
                  />
                  <FormHelperText id={nameHintId}>
                    {name.trim() !== '' && !login
                      ? 'A Twitch name is 4 to 25 letters, numbers or underscores.'
                      : 'Your name or your channel link. Only your public schedule is read.'}
                  </FormHelperText>
                </FormField>

                <FormField>
                  <FormLabel htmlFor={weekId}>Week</FormLabel>
                  <Select
                    value={weekStart || undefined}
                    onValueChange={(value) => {
                      // Radix's hidden native select can report an empty value: not a choice.
                      if (!value || value === weekStart) return;
                      setWeekStart(value);
                      setAnswer(null);
                    }}
                  >
                    <SelectTrigger id={weekId}>
                      <SelectValue placeholder="Choose a week" />
                    </SelectTrigger>
                    <SelectContent>
                      {weeks.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>

                <Button
                  type="submit"
                  variant="primary"
                  disabled={!login || !weekStart || reading}
                  className="self-start"
                >
                  {reading ? 'Reading Schedule' : 'Read Schedule'}
                </Button>
              </form>

              {readError ? (
                <Alert variant="danger" role="alert">
                  <AlertDescription>{readError}</AlertDescription>
                </Alert>
              ) : null}
              {answer && !answer.noSchedule ? (
                <p className="m-0 font-sans text-sm text-ink type-muted" role="status">
                  {`Read ${answer.broadcaster.displayName}'s schedule. Change the zone or the clock below and the times follow.`}
                </p>
              ) : null}
              {answer?.noSchedule ? (
                <Alert variant="info" role="status">
                  <AlertDescription>{NO_SCHEDULE_NOTE}</AlertDescription>
                </Alert>
              ) : null}
            </TabsContent>

            <TabsContent value="hand" className="mt-4 flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="m-0 font-sans text-sm text-ink type-muted">
                  Type each day, or tick Off for a day with no stream.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setHandRows(sampleWeek(hour12))}
                >
                  <MotionIcon icon={CalendarDaysIcon} className={ICON} />
                  Try A Sample
                </Button>
              </div>
              <ScheduleRowsTable
                label="Week"
                rows={handRows}
                onField={(index, field, value) =>
                  setHandRows((rows) => withRowField(rows, index, field, value))
                }
                onOff={(index, off) => setHandRows((rows) => withRowOff(rows, index, off))}
              />
            </TabsContent>
          </Tabs>

          <FormField>
            <FormLabel htmlFor={zoneId}>Time zone</FormLabel>
            <ScheduleZoneSelect id={zoneId} value={timeZone} onChange={setTimeZone} />
            <FormHelperText>
              The picture prints this zone, so viewers know which times these are.
            </FormHelperText>
          </FormField>

          <div className="flex flex-col gap-2">
            <span id={clockId} className="type-label text-sm text-ink">
              Clock
            </span>
            <Segmented
              labelledBy={clockId}
              options={CLOCK_OPTIONS}
              value={clockChoiceOf(hour12)}
              onValueChange={changeClock}
            />
          </div>

          {week.crowded ? (
            <Alert variant="warning" role="status">
              <AlertDescription>{week.crowded}</AlertDescription>
            </Alert>
          ) : null}
        </section>

        <section aria-labelledby={looksId} className="flex min-w-0 flex-col gap-5">
          <h2 id={looksId} className="m-0 type-heading text-lg text-ink">
            Choose A Look
          </h2>

          <div className="flex flex-col gap-2">
            <span id={formatId} className="type-label text-sm text-ink">
              Shape
            </span>
            <ChoiceTiles
              labelledBy={formatId}
              options={MAKER_FORMATS}
              value={format}
              onValueChange={setFormat}
              className="max-w-md"
            />
          </div>

          <ul
            aria-label="Themes"
            className={cn(
              'm-0 grid list-none gap-4 p-0',
              format === 'portrait' ? 'grid-cols-5' : 'grid-cols-3',
            )}
          >
            {MAKER_THEMES.map((theme) => (
              <li key={theme.id} className="min-w-0">
                <ThemeCard
                  presetId={theme.presetId}
                  name={theme.name}
                  format={format}
                  week={week}
                  chosen={theme.id === chosen?.id}
                  onChoose={() => setThemeId(theme.id)}
                />
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={!week.ready || opening} onClick={() => void open()}>
              {opening ? 'Opening' : 'Open In Design Studio'}
            </Button>
            {!week.ready ? (
              <p className="m-0 font-sans text-sm text-ink type-muted">
                Read your Twitch schedule first, or fill it in by hand.
              </p>
            ) : (
              <p className="m-0 font-sans text-sm text-ink type-muted">
                Every word can be changed in the editor, and the picture exports as a PNG.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * One look, drawn by the real renderer with the page's week. Memoised so a
 * keystroke in a row redraws the five cards once, not on every render of the
 * page.
 */
const ThemeCard = memo(function ThemeCard({
  presetId,
  name,
  format,
  week,
  chosen,
  onChoose,
}: {
  presetId: string;
  name: string;
  format: MakerFormat;
  week: MakerWeek;
  chosen: boolean;
  onChoose: () => void;
}) {
  const ring = useChosenRing();
  const design = useMemo(() => previewDocument(presetId, format, week), [presetId, format, week]);

  return (
    <button
      type="button"
      aria-pressed={chosen}
      onClick={onChoose}
      className={cn(
        'flex w-full flex-col gap-2 rounded-card border-2 border-outline bg-secondary p-2 text-left',
        pressSm,
        FOCUS,
        chosen && ring,
      )}
    >
      <span className={cn(INSET, 'flex items-center justify-center p-2')}>
        <span className="block w-full border-2 border-outline shadow-brutalSm">
          <SlideFrame design={design} />
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-1">
        {chosen ? (
          <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={3} />
        ) : null}
        <span className="min-w-0 type-ui text-sm text-ink">{name}</span>
      </span>
    </button>
  );
});
