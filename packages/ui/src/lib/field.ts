/**
 * Focus treatment for anything you type into or pick a value from (Input,
 * Textarea, Select/Combobox/MultiSelect/DatePicker triggers, the search box
 * inside a picker). Changed 2026-10-17 from the orange outline drawn 2px
 * outside the field: a text field matches `:focus-visible` on a plain mouse
 * click, so that outline read as a second, red border appearing on every
 * click. Now the field's own border turns the action blue with a soft glow,
 * the way SaaS forms signal "you're typing here".
 *
 * Buttons keep the outline focus ring (keyboard-only, so it never flashes on
 * click).
 */
export const FIELD_FOCUS =
  'outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-actionPrimary focus-visible:ring-3 focus-visible:ring-actionPrimary/20';

/** Keeps an invalid field red while focused instead of flipping to blue. */
export const FIELD_FOCUS_ERROR =
  'focus-visible:border-actionDanger focus-visible:ring-actionDanger/20';
