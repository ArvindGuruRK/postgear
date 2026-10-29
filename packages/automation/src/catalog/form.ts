/**
 * How a step's panel is laid out (Module 06). Zod schemas say what a config
 * may hold but not how to ask for it, so each definition carries an
 * optional `form`: plain data naming every field, the control that edits
 * it ("kind"), its words, and which tab it sits on. The web app's
 * `schema-form` renders it; a later module adds a panel by writing one.
 *
 * Paths are dotted config paths, the same ones validation issues carry in
 * `field`, so `tabForField` can say which tab to open for an issue. The
 * empty path is the whole config (the schedule builder edits every field of
 * the Schedule trigger at once).
 */
import { plainErrorMap } from '../validate/config-paths';
import { isBlank } from './fields';
import type { NodeDefinition } from './types';

/** Every control the panel knows, in the order the README lists them. */
export const FIELD_KINDS = [
  /** One line of text that takes data chips (or plain text when `acceptsData` is false). */
  'text',
  /** Several lines of text that take data chips. */
  'longText',
  /** One choice from `options`. */
  'select',
  /** Any number of choices from `options`; empty means `emptyLabel`. */
  'multiSelect',
  /** Workspace channels, with avatars. */
  'channels',
  /** Workspace post tags. */
  'tags',
  /** A saved connection of the definition's `connection.kind`. */
  'connection',
  /** The Schedule trigger's whole config. */
  'schedule',
  /** A condition group: rules, All Of or Any Of, and its sentence. */
  'condition',
  /** Paths' ordered cases, each a name and a condition; Otherwise stays last. */
  'cases',
  /** Rows of a name and a value (Set Fields, headers, columns), described by `row`. */
  'keyValue',
  /** Email addresses or chips, at most `max`. */
  'recipients',
  /** A whole number with a unit select at `unitPath`. */
  'duration',
  /** A whole number between `min` and `max`. */
  'number',
  /** Yes or no. */
  'toggle',
  /** The Manual trigger's input fields (label, type, required). */
  'manualInputs',
] as const;

export type FieldKind = (typeof FIELD_KINDS)[number];

/** The two tabs that hold fields. Test is the run's, not the config's. */
export const FORM_TABS = ['setup', 'configure'] as const;
export type FormTab = (typeof FORM_TABS)[number];

/**
 * Where a field lives in the step panel: a tab, the collapsed Settings
 * section (On Error, Turn Off), or the step's name in the header.
 */
export type FieldPlace = FormTab | 'settings' | 'name';

export interface FieldOption {
  value: string;
  /** Sentence case: a form choice, not a name. */
  label: string;
}

/** What one row of a `keyValue` field holds. */
export interface KeyValueRow {
  /** The row's own path to its name ("name", "header"). */
  key: string;
  /** The row's own path to its value, a chip input ("value"). */
  value: string;
  /** The row's own path to a type, chosen from the field's `options`. */
  type?: string;
  /** Sentence case column words: "Name", "Value". */
  keyLabel: string;
  valueLabel: string;
}

export interface FieldSpec {
  /** Dotted config path; '' is the whole config. */
  path: string;
  kind: FieldKind;
  /** Sentence case, the form label above the control. */
  label: string;
  /** A sentence under the control. */
  help?: string;
  /** "Enter your ..." for typed fields. */
  placeholder?: string;
  /** Draws the asterisk. What is really required is the definition's `required` list. */
  required?: boolean;
  /** Text fields: data chips and Insert Data. */
  acceptsData?: boolean;
  /** `select` and `multiSelect` choices, `keyValue` row types, `duration` units. */
  options?: readonly FieldOption[];
  /** Shown only while the config at `path` equals `equals`. */
  showIf?: { path: string; equals: string | number | boolean };
  /** `number` and `duration` bounds; the most rows a list field takes. */
  min?: number;
  max?: number;
  /** `duration`: the sibling config path that holds the unit. */
  unitPath?: string;
  /** `keyValue`: what each row holds. */
  row?: KeyValueRow;
  /** `condition` and `cases`: the words before the rule sentence ("Only continue if"). */
  lead?: string;
  /** `channels`, `tags`, `multiSelect`: what choosing nothing means ("Any channel"). */
  emptyLabel?: string;
}

export interface FormSpec {
  tabs: { setup: readonly FieldSpec[]; configure: readonly FieldSpec[] };
  /** Fixed sentences shown under the Configure fields ("A review waits up to 7 days."). */
  notes?: readonly string[];
}

type FormOwner = Pick<NodeDefinition, 'form' | 'connection' | 'channels'>;

function within(base: string, path: string): boolean {
  return base === '' || base === path || path.startsWith(`${base}.`);
}

/** True when `spec` edits the config at `path` or something inside it (a duration its unit too). */
function covers(spec: FieldSpec, path: string): boolean {
  return within(spec.path, path) || (spec.unitPath !== undefined && within(spec.unitPath, path));
}

/**
 * The field that edits a config path: the most specific one, so
 * `cases.0.condition.rules.1.left` finds the Paths cases and `message`
 * finds Message. `undefined` when no field of the form covers it.
 */
export function fieldSpecFor(
  definition: FormOwner,
  path: string,
): { tab: FormTab; spec: FieldSpec } | undefined {
  const form = definition.form;
  if (!form) return undefined;
  let best: { tab: FormTab; spec: FieldSpec } | undefined;
  for (const tab of FORM_TABS) {
    for (const spec of form.tabs[tab]) {
      if (!covers(spec, path)) continue;
      if (!best || spec.path.length > best.spec.path.length) best = { tab, spec };
    }
  }
  return best;
}

/**
 * Which part of the step panel holds `path` (an issue's `field`), for
 * focus-the-field. The step's own settings are not config: `name` is the
 * header, `onError` and `disabled` the Settings section. A config path no
 * form field covers falls back to Setup for the connection and the
 * channels a step posts to, and to Configure for the rest.
 */
export function tabForField(definition: FormOwner, path: string | undefined): FieldPlace {
  if (path === undefined || path === '') {
    return definition.form && definition.form.tabs.setup.length > 0 ? 'setup' : 'configure';
  }
  if (path === 'name') return 'name';
  const head = path.split('.')[0];
  if (head === 'onError' || head === 'disabled' || head === 'notes') return 'settings';
  const found = fieldSpecFor(definition, path);
  if (found) return found.tab;
  if (definition.connection && head === definition.connection.field) return 'setup';
  if (definition.channels === 'act' && head === 'channels') return 'setup';
  return 'configure';
}

/** True when `spec` should show for this config (its `showIf` holds). */
export function isFieldShown(spec: FieldSpec, config: Record<string, unknown>): boolean {
  if (!spec.showIf) return true;
  let value: unknown = config;
  for (const part of spec.showIf.path.split('.')) {
    if (typeof value !== 'object' || value === null) return false;
    value = (value as Record<string, unknown>)[part];
  }
  return value === spec.showIf.equals;
}

/**
 * Whether a tab's required fields are filled, for the tick on Setup.
 * Reads the definition's `required` list (with its `when`), the same rule
 * validation uses, so the tick and the issue marker agree.
 */
export function tabComplete(
  definition: Pick<NodeDefinition, 'form' | 'required' | 'connection' | 'channels'>,
  tab: FormTab,
  config: Record<string, unknown>,
): boolean {
  const read = (path: string) => {
    let value: unknown = config;
    for (const part of path.split('.')) {
      if (typeof value !== 'object' || value === null) return undefined;
      value = (value as Record<string, unknown>)[part];
    }
    return value;
  };
  for (const required of definition.required ?? []) {
    if (tabForField(definition, required.path) !== tab) continue;
    if (required.when && !required.when(config)) continue;
    if (isBlank(read(required.path))) return false;
  }
  if (definition.connection && !definition.connection.optional) {
    if (tabForField(definition, definition.connection.field) === tab) {
      if (isBlank(read(definition.connection.field))) return false;
    }
  }
  return true;
}

/**
 * The config's schema problems in plain words, one per config path (the
 * first one wins), for the form's inline errors. The same words
 * validation's `node.config_invalid` issues carry, without waiting for a
 * whole-graph check. A problem with the whole config has the path ''.
 */
export function configErrors(
  definition: Pick<NodeDefinition, 'configSchema'>,
  config: unknown,
): Record<string, string> {
  const parsed = definition.configSchema.safeParse(config, { errorMap: plainErrorMap });
  if (parsed.success) return {};
  const errors: Record<string, string> = {};
  for (const problem of parsed.error.issues) {
    const path = problem.path.join('.');
    errors[path] ??= problem.message;
  }
  return errors;
}
