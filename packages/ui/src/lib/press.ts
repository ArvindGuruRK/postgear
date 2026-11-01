import { cn } from './utils';

/**
 * The press interaction for pressable controls (2026-10-18), after the
 * neobrutalism.dev button: at rest the control stands on its hard shadow; on
 * hover, and while pressed, it slides down and right by exactly the shadow's
 * depth and the shadow collapses, so it reads as pushed flat into the page.
 *
 * The distance is the theme's own offset token (`--brutal-offset-*` in
 * colors.css), not a fixed pixel count: light mode's shadows are shallower
 * than dark mode's, and White and Sky use one 2px depth throughout, so a
 * hard-coded move would overshoot or stop short of the shadow it sinks into.
 *
 * The transition names `translate` because Tailwind v4's translate-* classes
 * set the `translate` property, not `transform`; transitioning `transform`
 * would leave the press snapping instead of moving.
 */
const PRESS_BASE = cn(
  'transition-[translate,box-shadow] duration-100 ease-out',
  'motion-reduce:transition-none',
  'disabled:pointer-events-none disabled:shadow-none',
);

/** For controls on the small shadow (`shadow-brutalSm`): Button, tiles, icon buttons. */
export const pressSm = cn(
  PRESS_BASE,
  'shadow-brutalSm',
  'hover:translate-x-(--brutal-offset-sm) hover:translate-y-(--brutal-offset-sm) hover:shadow-brutalPressed',
  'active:translate-x-(--brutal-offset-sm) active:translate-y-(--brutal-offset-sm) active:shadow-brutalPressed',
);

/**
 * For controls on the medium shadow (`shadow-brutalMd`). No control uses it
 * since Button moved to `pressSm` (2026-10-31, to match the calendar's
 * tiles); kept for a control that genuinely needs the deeper shadow.
 */
export const pressMd = cn(
  PRESS_BASE,
  'shadow-brutalMd',
  'hover:translate-x-(--brutal-offset-md) hover:translate-y-(--brutal-offset-md) hover:shadow-brutalPressed',
  'active:translate-x-(--brutal-offset-md) active:translate-y-(--brutal-offset-md) active:shadow-brutalPressed',
);

/**
 * The press the other way round (2026-11-01), for a toolbar that wants flat
 * buttons: no shadow at rest and none on hover; while pressed the control
 * rises up and left by the shadow's depth and its shadow shows beneath it,
 * then settles back down when let go. Put it after a Button's own classes,
 * which it overrides.
 */
export const liftSm = cn(
  'transition-[translate,box-shadow] duration-150 ease-out',
  'motion-reduce:transition-none',
  'shadow-none hover:translate-x-0 hover:translate-y-0 hover:shadow-none',
  'active:-translate-x-(--brutal-offset-sm) active:-translate-y-(--brutal-offset-sm) active:shadow-brutalSm',
);
