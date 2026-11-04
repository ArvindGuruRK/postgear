/**
 * Focus treatment for anything you type into or pick a value from (Input,
 * Textarea, Select/Combobox/MultiSelect/DatePicker triggers, the search box
 * inside a picker). A text field matches `:focus-visible` on a plain mouse
 * click, so this shows on every click and has to stay quiet: the field's own
 * border turns the action blue, with nothing beside or under it (the owner's
 * call, 2026-11-04). That took away a 3px soft glow and, while focused, the hard
 * shadow. A thinner line was tried the same day and rejected as too thin.
 *
 * Buttons keep the outline focus ring (keyboard-only, so it never flashes on
 * click).
 */
export const FIELD_FOCUS =
  'outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-actionPrimary focus-visible:shadow-none';

/** Keeps an invalid field red while focused instead of flipping to blue. */
export const FIELD_FOCUS_ERROR = 'focus-visible:border-actionDanger';

/** The same on a box around a bare input or editor, where the focus lands inside it. */
export const FIELD_FOCUS_WITHIN =
  'outline-none transition-[border-color,box-shadow] duration-150 focus-within:border-actionPrimary focus-within:shadow-none';

export const FIELD_FOCUS_WITHIN_ERROR = 'focus-within:border-actionDanger';
