/**
 * Putting a week on a schedule design (Sprint 13), as pure edits like every
 * other in `document.ts`: take a design, return a new one, or the same one by
 * reference when nothing changed.
 *
 * A design holds its week in the `rows` slot of its schedule slide (one slide
 * today; every rows slot is written, so a second schedule slide added later
 * would show the same week) and where the week came from in
 * `DesignDocument.schedule`. The Schedule Maker's open step, the editor's
 * table, its clock switch and Refresh From Twitch all write through here.
 */
import { cleanScheduleRows, updateElement } from '../document';
import { findLayout } from '../layouts';
import type { DesignDocument, ScheduleRow, ScheduleSource, SlotId } from '../types';

/** The first rows slot in the design: the slide it is on and its slot id. */
export function scheduleSlotOf(
  document: DesignDocument,
): { slideId: string; slotId: SlotId; index: number } | null {
  for (const [index, slide] of document.slides.entries()) {
    const slot = findLayout(slide.layoutId)?.slots.find((entry) => entry.kind === 'rows');
    if (slot) return { slideId: slide.id, slotId: slot.id, index };
  }
  return null;
}

/** The week the design shows, or null for a design with no schedule slide. */
export function scheduleRowsOf(document: DesignDocument): ScheduleRow[] | null {
  const found = scheduleSlotOf(document);
  if (!found) return null;
  return document.slides[found.index].elements[found.slotId]?.rows ?? [];
}

function sameRows(a: readonly ScheduleRow[] | undefined, b: readonly ScheduleRow[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every(
    (row, index) =>
      row.day === b[index].day &&
      row.time === b[index].time &&
      row.title === b[index].title &&
      (row.off === true) === (b[index].off === true),
  );
}

/** The week on every rows slot of the design. */
export function setScheduleRows(
  document: DesignDocument,
  rows: readonly ScheduleRow[],
): DesignDocument {
  const clean = cleanScheduleRows(rows);
  let next = document;

  for (const slide of document.slides) {
    const layout = findLayout(slide.layoutId);
    for (const slot of layout?.slots ?? []) {
      if (slot.kind !== 'rows') continue;
      if (sameRows(slide.elements[slot.id]?.rows, clean)) continue;
      next = updateElement(next, slide.id, slot.id, { rows: clean });
    }
  }

  return next;
}

function sameSource(a: ScheduleSource | undefined, b: ScheduleSource): boolean {
  return (
    a !== undefined &&
    a.source === b.source &&
    a.login === b.login &&
    a.timeZone === b.timeZone &&
    a.weekStart === b.weekStart &&
    a.fetchedAt === b.fetchedAt &&
    a.hour12 === b.hour12 &&
    (a.vacationUntil ?? null) === (b.vacationUntil ?? null)
  );
}

/** Where the week came from, its zone and its clock. */
export function setScheduleSource(
  document: DesignDocument,
  source: ScheduleSource,
): DesignDocument {
  if (sameSource(document.schedule, source)) return document;

  const schedule: ScheduleSource = { ...source };
  if (schedule.vacationUntil === undefined || schedule.vacationUntil === null) {
    delete schedule.vacationUntil;
  }
  return { ...document, schedule };
}

export interface ScheduleInput {
  source: ScheduleSource;
  rows: readonly ScheduleRow[];
}

/** A whole week at once: the rows and their source. What the open step writes. */
export function applySchedule(document: DesignDocument, input: ScheduleInput): DesignDocument {
  return setScheduleSource(setScheduleRows(document, input.rows), input.source);
}
