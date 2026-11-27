'use client';

/**
 * The Schedule element of the editor's Element tab (Sprint 13, Module 14
 * section C4): a week of streams as seven small rows (day, time, title, Off),
 * the 12 or 24 hour clock, the time zone, and, for a week read from Twitch,
 * **Refresh From Twitch**.
 *
 * - Typing is one undo step per burst, as everywhere in the editor; Off, the
 *   clock and the zone are steps of their own.
 * - The clock converts every time already written, so hand edits survive it.
 * - A zone change on a week typed by hand changes only the zone line. On a
 *   week read from Twitch it reads the schedule again (the server's copy, so
 *   usually no call to Twitch) and rewrites the times in the new zone; when
 *   the rows were edited since, it asks first.
 * - Refresh From Twitch always asks first, because it replaces hand edits.
 */
import { RefreshCwIcon } from '@animateicons/react/lucide/refresh-cw-icon';
import {
  type DesignDocument,
  type DesignSlide,
  type ScheduleSource,
  type SlotDef,
  scheduleRowsOf,
} from '@postgear/design-engine';
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  FormField,
  FormLabel,
  MotionIcon,
} from '@postgear/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ScheduleAnswer, ScheduleFetchBody } from '@/types/studio-schedules';
import type { ApplyChange } from './editor-state';
import { GroupLabel, NOTE, Segmented } from './panel-ui';
import {
  CLOCK_OPTIONS,
  type ClockChoice,
  clockChoiceOf,
  crowdedWarning,
  fetchFailureMessage,
  fullWeek,
  NO_SCHEDULE_NOTE,
  REPLACE_EDITS_QUESTION,
  refreshWeek,
  rowsFromAnswer,
  sameRows,
  sourceOf,
  twitchSource,
  withHour12,
  withRowField,
  withRowOff,
  withSchedule,
  withZone,
} from './schedule-field-model';
import { ScheduleRowsTable } from './schedule-rows-table';
import { ScheduleZoneSelect } from './schedule-zone-select';

const ICON = 'h-4 w-4';

/** What the confirm dialog is about to do. */
type Pending = { kind: 'refresh' } | { kind: 'zone'; zone: string; answer: ScheduleAnswer };

export function ScheduleField({
  document,
  slide,
  slot,
  onChange,
}: {
  document: DesignDocument;
  slide: DesignSlide;
  slot: SlotDef;
  onChange: ApplyChange;
}) {
  const clockId = useId();
  const zoneId = useId();
  const slideId = slide.id;
  const rows = fullWeek(slide.elements[slot.id]?.rows);
  const source = sourceOf(document);
  const fromTwitch = source.source === 'twitch' && source.login !== null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  /** The rows on the design as it is when the change lands, always seven. */
  const latestRows = (latest: DesignDocument) => fullWeek(scheduleRowsOf(latest));

  async function fetchWeek(timeZone: string, weekStart: string): Promise<ScheduleAnswer | null> {
    if (!source.login) return null;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError(null);
    try {
      const body: ScheduleFetchBody = { login: source.login, timeZone, weekStart };
      return await api<ScheduleAnswer>('/studio/schedules/fetch', {
        method: 'POST',
        body,
        signal: controller.signal,
      });
    } catch (cause) {
      if (!controller.signal.aborted) setError(fetchFailureMessage(cause));
      return null;
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setBusy(false);
      }
    }
  }

  /** Writes a fetched week in a zone over the rows: one undo step. */
  function applyAnswer(answer: ScheduleAnswer, timeZone: string, hour12: boolean) {
    const week = rowsFromAnswer(answer, { timeZone, hour12 });
    const next: ScheduleSource = twitchSource(answer, {
      timeZone,
      hour12,
      vacationUntil: week.vacationUntil,
    });
    onChange((latest) => withSchedule(latest, week.rows, next));
  }

  async function changeZone(zone: string) {
    if (!fromTwitch) {
      onChange((latest) => withZone(latest, zone));
      return;
    }
    const answer = await fetchWeek(zone, refreshWeek({ ...source, timeZone: zone }, new Date()));
    if (!answer) return;
    // Unchanged since the last read: rewrite without asking. Edited: ask first.
    const asFetched = rowsFromAnswer(answer, { timeZone: source.timeZone, hour12: source.hour12 });
    if (answer.weekStart === source.weekStart && sameRows(asFetched.rows, rows)) {
      applyAnswer(answer, zone, source.hour12);
    } else {
      setPending({ kind: 'zone', zone, answer });
    }
  }

  async function confirm() {
    const current = pending;
    setPending(null);
    if (!current) return;
    if (current.kind === 'zone') {
      applyAnswer(current.answer, current.zone, source.hour12);
      return;
    }
    const answer = await fetchWeek(source.timeZone, refreshWeek(source, new Date()));
    if (answer) applyAnswer(answer, source.timeZone, source.hour12);
  }

  const crowded = crowdedWarning(rows);
  const noSchedule = fromTwitch && rows.every((row) => row.off === true);

  return (
    <div className="flex flex-col gap-5">
      {fromTwitch ? (
        <p
          className={NOTE}
        >{`Filled in from ${source.login}'s Twitch schedule. Every word can be changed.`}</p>
      ) : null}
      {noSchedule ? <p className={NOTE}>{NO_SCHEDULE_NOTE}</p> : null}
      {source.vacationUntil ? (
        <p className={NOTE}>
          Twitch says this channel is on a break, so the time zone line says when it ends.
        </p>
      ) : null}

      <ScheduleRowsTable
        label="Week"
        rows={rows}
        onField={(index, field, value) =>
          onChange(
            (latest) =>
              withSchedule(
                latest,
                withRowField(latestRows(latest), index, field, value),
                sourceOf(latest),
              ),
            { coalesceKey: `schedule:${slideId}:${index}:${field}` },
          )
        }
        onOff={(index, off) =>
          onChange((latest) =>
            withSchedule(latest, withRowOff(latestRows(latest), index, off), sourceOf(latest)),
          )
        }
      />

      {crowded ? (
        <Alert variant="warning" role="status">
          <AlertDescription>{crowded}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <GroupLabel id={clockId}>Clock</GroupLabel>
        <Segmented
          labelledBy={clockId}
          options={CLOCK_OPTIONS}
          value={clockChoiceOf(source.hour12)}
          onValueChange={(choice: ClockChoice) =>
            onChange((latest) => withHour12(latest, choice === '12'))
          }
        />
      </div>

      <FormField>
        <FormLabel htmlFor={zoneId}>Time zone</FormLabel>
        <ScheduleZoneSelect
          id={zoneId}
          value={source.timeZone}
          disabled={busy}
          onChange={(zone) => void changeZone(zone)}
        />
      </FormField>

      {error ? (
        <Alert variant="danger" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {fromTwitch ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => setPending({ kind: 'refresh' })}
          className="self-start"
        >
          <MotionIcon icon={RefreshCwIcon} className={ICON} />
          {busy ? 'Reading Twitch' : 'Refresh From Twitch'}
        </Button>
      ) : null}

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{REPLACE_EDITS_QUESTION}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === 'zone'
                ? "Every row is rewritten from Twitch's schedule in the new time zone. What you typed is replaced."
                : "Every row is read again from Twitch's schedule. What you typed is replaced."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep My Edits</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirm()}>Replace</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
