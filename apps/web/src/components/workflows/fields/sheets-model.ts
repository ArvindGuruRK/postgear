/**
 * Rules behind the Google Sheets fields (Module 13): reading the stored
 * spreadsheet, tab and columns, and what Refresh Columns does with a
 * header row read again. Pure, so the merge is unit tested.
 */
import type { SheetTabRef } from '@/types/workflows';

export interface SheetColumn {
  header: string;
  /** Template text: data chips and typed words. */
  value: string;
}

export interface PickedSpreadsheet {
  id: string;
  name: string;
}

/** The sample headers a simulated spreadsheet is created with when the step has no columns yet. */
export const SAMPLE_HEADERS = ['Date', 'Channel', 'Text', 'Link'] as const;

/** The name Use A Sample Spreadsheet gives. */
export const SAMPLE_SPREADSHEET_NAME = 'Social Report';

export function spreadsheetOf(value: unknown): PickedSpreadsheet | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, name } = value as Record<string, unknown>;
  return typeof id === 'string' && id !== ''
    ? { id, name: typeof name === 'string' ? name : '' }
    : null;
}

export function sheetOf(value: unknown): SheetTabRef | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, title } = value as Record<string, unknown>;
  return typeof id === 'number' && typeof title === 'string' && title !== '' ? { id, title } : null;
}

export function columnsOf(value: unknown): SheetColumn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
    )
    .map((entry) => ({
      header: typeof entry.header === 'string' ? entry.header : '',
      value: typeof entry.value === 'string' ? entry.value : '',
    }));
}

/** The headers a new spreadsheet starts with: the step's own columns, without blanks or repeats. */
export function headersForNew(columns: readonly SheetColumn[]): string[] {
  const seen = new Set<string>();
  for (const column of columns) {
    const header = column.header.trim();
    if (header) seen.add(header);
  }
  return [...seen].slice(0, 50);
}

/** Columns for a header row read the first time: one empty value per header. */
export function columnsFromHeaders(headers: readonly string[]): SheetColumn[] {
  return headers.filter((header) => header !== '').map((header) => ({ header, value: '' }));
}

/**
 * Refresh Columns: the tab's header row as it is now, with the values the
 * step already had kept by header. New headers come in empty, in the
 * sheet's order. Columns whose header is gone stay at the end with their
 * values (so nothing typed is lost) and are listed in `missing` for the
 * red flag; the person removes them.
 */
export function refreshColumns(
  current: readonly SheetColumn[],
  headers: readonly string[],
): { columns: SheetColumn[]; missing: string[]; added: string[] } {
  const byHeader = new Map<string, string>();
  for (const column of current) {
    if (!byHeader.has(column.header)) byHeader.set(column.header, column.value);
  }
  const present = new Set<string>();
  const columns: SheetColumn[] = [];
  const added: string[] = [];
  for (const header of headers) {
    if (header === '' || present.has(header)) continue;
    present.add(header);
    if (byHeader.has(header)) columns.push({ header, value: byHeader.get(header) ?? '' });
    else {
      columns.push({ header, value: '' });
      added.push(header);
    }
  }
  const missing: string[] = [];
  for (const column of current) {
    if (present.has(column.header) || missing.includes(column.header)) continue;
    missing.push(column.header);
    columns.push(column);
  }
  return { columns, missing, added };
}

/** The headers of `columns` the tab no longer has (red rows), once the header row is known. */
export function missingHeaders(
  columns: readonly SheetColumn[],
  headers: readonly string[] | null,
): Set<string> {
  if (!headers) return new Set();
  const known = new Set(headers);
  return new Set(columns.map((column) => column.header).filter((header) => !known.has(header)));
}
