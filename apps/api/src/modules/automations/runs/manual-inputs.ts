/**
 * Manual trigger inputs for a test run (WF-7.4): the fields a person fills
 * in when a workflow starts by hand, checked against the trigger's own field
 * list.
 *
 * The inputs are laid over the chosen trigger data's `inputs` (pinned, last
 * or sample), so a test can change one field and keep the rest. A field sent
 * blank is cleared rather than kept from that data, because a blank optional
 * field is what a real Run Now with that field left empty gives. Required
 * fields are checked on the result.
 *
 * Pure: the service turns a refusal into a 422.
 */

import { RUN_MESSAGES } from './automation-runs.messages';
import { MANUAL_INPUT_KEY } from './dto/automation-runs.schema';

interface ManualField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'choice';
  required: boolean;
  options: string[];
}

export type ManualInputsResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; message: string };

/** A number typed as text: digits with an optional sign and decimals, nothing else. */
const NUMBER_TEXT = /^-?\d+(\.\d+)?$/;

/**
 * The trigger payload `{ ...base, inputs }` for a Manual trigger whose
 * config is `config`, with `given` laid over `base.inputs`.
 */
export function applyManualInputs(
  config: unknown,
  base: unknown,
  given: Readonly<Record<string, string | number>>,
): ManualInputsResult {
  const fields = manualFields(config);
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const start = isRecord(base) ? base : {};
  const inputs = new Map<string, unknown>();

  // Only the trigger's current fields carry over: older data may hold fields
  // that were removed since.
  if (isRecord(start.inputs)) {
    for (const [key, value] of Object.entries(start.inputs)) {
      if (byKey.has(key)) inputs.set(key, value);
    }
  }

  for (const [key, raw] of Object.entries(given)) {
    const field = byKey.get(key);
    if (!field) return { ok: false, message: RUN_MESSAGES.UNKNOWN_INPUT };

    const text = typeof raw === 'string' ? raw.trim() : null;
    if (text === '') {
      inputs.delete(key);
      continue;
    }

    if (field.type === 'number') {
      const value =
        typeof raw === 'number' ? raw : NUMBER_TEXT.test(text ?? '') ? Number(text) : NaN;
      if (!Number.isFinite(value)) {
        return { ok: false, message: RUN_MESSAGES.inputNotNumber(field.label) };
      }
      inputs.set(key, value);
    } else if (field.type === 'choice') {
      const value = text ?? String(raw);
      if (!field.options.includes(value)) {
        return { ok: false, message: RUN_MESSAGES.inputNotChoice(field.label) };
      }
      inputs.set(key, value);
    } else {
      inputs.set(key, text ?? String(raw));
    }
  }

  for (const field of fields) {
    const value = inputs.get(field.key);
    if (field.required && (value === undefined || value === null || value === '')) {
      return { ok: false, message: RUN_MESSAGES.inputRequired(field.label) };
    }
  }

  return { ok: true, payload: { ...start, inputs: Object.fromEntries(inputs) } };
}

/** The Manual trigger's fields, read defensively: a saved draft may be half filled in. */
function manualFields(config: unknown): ManualField[] {
  const list = isRecord(config) && Array.isArray(config.fields) ? config.fields : [];
  return list.flatMap((entry): ManualField[] => {
    if (!isRecord(entry) || typeof entry.key !== 'string' || !MANUAL_INPUT_KEY.test(entry.key)) {
      return [];
    }
    const type = entry.type === 'number' || entry.type === 'choice' ? entry.type : 'text';
    const label =
      typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : entry.key;
    const options = Array.isArray(entry.options)
      ? entry.options.filter((option): option is string => typeof option === 'string')
      : [];
    return [{ key: entry.key, label, type, required: entry.required === true, options }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
