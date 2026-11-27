/**
 * The measurements of a schedule's rows (Sprint 13, Module 14 section C1),
 * in one place so the renderer draws them and the library's tests measure
 * them with the same numbers.
 *
 * Seven places are laid out whatever the row count, so a row is the same
 * height in every design; a landscape fills two columns, four days and then
 * three. Each row is a card of three cells (day, time, title), each one line,
 * sized in `em` of the row's type so they shrink together.
 */
import { formatSpec, shortEdge } from '../formats';
import { type FormatId, MAX_SCHEDULE_ROWS, type Rect } from '../types';

/** The day and time cells, in `em` of the row's type, padding included. */
export const DAY_WIDTH_EM = 3.4;
export const TIME_WIDTH_EM = 5.6;
/** Each cell's padding, in `em`: across, and above and below. */
export const CELL_PAD_X_EM = 0.55;
export const CELL_PAD_Y_EM = 0.3;
/** A cell's one line. */
export const ROW_LINE_HEIGHT = 1.2;
/** The largest a row's type may be, as a share of the row's height. */
const SIZE_OF_ROW = 0.42;

export interface RowsGeometry {
  columns: 1 | 2;
  /** How many rows a column holds. */
  perColumn: number;
  /** Pixels between rows, and between columns. */
  rowGap: number;
  columnGap: number;
  rowHeight: number;
  columnWidth: number;
  /** The row's type size, in pixels, before the fitter shrinks a cell. */
  size: number;
  radius: number;
  /** The room each cell's words have, in pixels, at that size. */
  inner: { day: number; time: number; title: number; height: number };
}

/**
 * Where the week's rows go inside `rect` (percentages of the canvas) in a
 * format, at most `baseSize` pixels tall (the theme's size for the slot).
 */
export function rowsGeometry(input: {
  rect: Rect;
  format: FormatId;
  columns: 1 | 2;
  baseSize: number;
}): RowsGeometry {
  const spec = formatSpec(input.format);
  const short = shortEdge(input.format);
  const perColumn = Math.ceil(MAX_SCHEDULE_ROWS / input.columns);
  const rowGap = short * 0.014;
  const columnGap = short * 0.03;
  const width = (input.rect.w / 100) * spec.width;
  const height = (input.rect.h / 100) * spec.height;
  const rowHeight = (height - rowGap * (perColumn - 1)) / perColumn;
  const columnWidth = (width - columnGap * (input.columns - 1)) / input.columns;
  // The theme's size, unless a short row (a square's week) needs smaller type.
  const size = Math.min(input.baseSize, rowHeight * SIZE_OF_ROW);
  const pad = 2 * CELL_PAD_X_EM * size;

  return {
    columns: input.columns,
    perColumn,
    rowGap,
    columnGap,
    rowHeight,
    columnWidth,
    size,
    radius: Math.max(4, short * 0.012),
    inner: {
      day: DAY_WIDTH_EM * size - pad,
      time: TIME_WIDTH_EM * size - pad,
      title: columnWidth - (DAY_WIDTH_EM + TIME_WIDTH_EM) * size - pad,
      height: rowHeight - 2 * CELL_PAD_Y_EM * size,
    },
  };
}
