/**
 * Per-platform post settings, declared as data (2026-10-19, after Postiz's
 * provider settings).
 *
 * ## Why one declaration
 *
 * Three places must agree on what a YouTube title or a TikTok privacy level
 * is: the composer that renders the fields, the API that validates a save,
 * and the provider that sends them to the platform. Postiz keeps a class
 * validator DTO per provider on the server and a hand-built form per provider
 * in the browser. Here, as with `rules.ts`, each provider's fields are one
 * object: the composer renders them generically from `settingsFieldsFor`, the
 * API checks a save with `validateProviderSettings`, and the provider reads
 * the same keys from `PostDetails.settings`.
 *
 * ## Only what the provider honours
 *
 * A field is listed only when the provider's `post()` actually sends it.
 * A setting the platform never receives would be a lie the composer tells, so
 * Instagram and LinkedIn, whose providers take no options, have no entry and
 * the composer shows no settings for them.
 *
 * This file must stay browser-safe: the web app bundles the composer entry.
 */
import { isSafeHref } from './document';

export interface SettingOption {
  value: string;
  label: string;
}

export type SettingField =
  | {
      key: string;
      label: string;
      kind: 'text';
      required?: boolean;
      minLength?: number;
      maxLength?: number;
      /** The value must be an `http:` or `https:` link. */
      url?: boolean;
      placeholder?: string;
      hint?: string;
    }
  | {
      key: string;
      label: string;
      kind: 'select';
      options: SettingOption[];
      /** What the provider sends when nothing is chosen. */
      default: string;
      hint?: string;
    }
  | { key: string; label: string; kind: 'boolean'; default: boolean; hint?: string }
  | {
      key: string;
      label: string;
      /** A list of short strings, stored as `string[]`. */
      kind: 'tags';
      max: number;
      /** Measured as YouTube measures it: see `tagsTotalLength`. */
      maxTotalLength?: number;
      hint?: string;
    };

/** Long enough for any real link; it bounds what a stored setting can hold. */
const MAX_LINK_LENGTH = 2_048;

/**
 * Every provider with settings, keyed by its identifier
 * (`Integration.providerIdentifier`). Providers with none are absent.
 */
export const PROVIDER_SETTINGS: Record<string, SettingField[]> = {
  youtube: [
    {
      key: 'title',
      label: 'Title',
      kind: 'text',
      maxLength: 100,
      hint: "Uses the post's first line when empty",
    },
    {
      key: 'privacyStatus',
      label: 'Visibility',
      kind: 'select',
      options: [
        { value: 'public', label: 'Public' },
        { value: 'unlisted', label: 'Unlisted' },
        { value: 'private', label: 'Private' },
      ],
      default: 'public',
    },
    { key: 'madeForKids', label: 'Made for kids', kind: 'boolean', default: false },
    // YouTube's own cap is 500 characters across all tags; the count of 15
    // keeps the field readable, as Postiz's tag picker does.
    { key: 'tags', label: 'Tags', kind: 'tags', max: 15, maxTotalLength: 500 },
  ],
  tiktok: [
    {
      key: 'privacyLevel',
      label: 'Who can see this video',
      kind: 'select',
      options: [
        { value: 'PUBLIC_TO_EVERYONE', label: 'Everyone' },
        { value: 'MUTUAL_FOLLOW_FRIENDS', label: 'Friends' },
        { value: 'FOLLOWER_OF_CREATOR', label: 'Followers' },
        { value: 'SELF_ONLY', label: 'Only me' },
      ],
      default: 'PUBLIC_TO_EVERYONE',
    },
    { key: 'disableComment', label: 'Turn off comments', kind: 'boolean', default: false },
    { key: 'disableDuet', label: 'Turn off Duet', kind: 'boolean', default: false },
    { key: 'disableStitch', label: 'Turn off Stitch', kind: 'boolean', default: false },
  ],
  pinterest: [
    { key: 'title', label: 'Pin title', kind: 'text', maxLength: 100 },
    {
      key: 'link',
      label: 'Destination link',
      kind: 'text',
      url: true,
      maxLength: MAX_LINK_LENGTH,
      placeholder: 'https://',
    },
  ],
  x: [
    {
      key: 'replySettings',
      label: 'Who can reply',
      kind: 'select',
      options: [
        { value: 'everyone', label: 'Everyone' },
        { value: 'following', label: 'Accounts you follow' },
        { value: 'mentionedUsers', label: 'Accounts you mention' },
        { value: 'subscribers', label: 'Subscribers' },
        { value: 'verified', label: 'Verified accounts' },
      ],
      default: 'everyone',
    },
  ],
  facebook: [
    {
      key: 'link',
      label: 'Link',
      kind: 'text',
      url: true,
      maxLength: MAX_LINK_LENGTH,
      placeholder: 'https://',
      hint: 'Attached to text-only posts',
    },
  ],
};

/** The settings a provider takes, in display order; `[]` when it takes none. */
export function settingsFieldsFor(providerIdentifier: string): SettingField[] {
  return Object.hasOwn(PROVIDER_SETTINGS, providerIdentifier)
    ? PROVIDER_SETTINGS[providerIdentifier]
    : [];
}

export interface SettingsIssue {
  /** The field's `key`; empty when the settings as a whole are malformed. */
  key: string;
  /** Written for the person composing, naming the field by its label. */
  message: string;
}

/**
 * Checks one channel's settings against its provider's fields.
 *
 * - **Unknown keys are dropped**, so nothing a provider does not read is ever
 *   stored, and `customized` (the composer's own flag) can never be smuggled
 *   in as a setting.
 * - **Nothing is coerced.** `"true"` is not a boolean and `5` is not text; a
 *   value of the wrong type is an issue, not a guess.
 * - **Absent means unset.** `undefined`, `null` and a text value that is
 *   empty or only spaces are left out of `values`, so the provider falls back
 *   to its default (the first line as a YouTube title, public visibility).
 * - **Every check runs in both modes except `required`**, which only the
 *   queue enforces: a draft may leave a required field empty, but it may not
 *   store a value the platform would refuse.
 *
 * `values` holds only the fields that passed, in declaration order.
 */
export function validateProviderSettings(
  providerIdentifier: string,
  values: unknown,
  mode: 'draft' | 'queue',
): { values: Record<string, unknown>; issues: SettingsIssue[] } {
  const accepted: Record<string, unknown> = {};
  const issues: SettingsIssue[] = [];

  if (values === undefined || values === null) {
    values = {};
  }

  if (typeof values !== 'object' || Array.isArray(values)) {
    return {
      values: accepted,
      issues: [{ key: '', message: 'Settings must be a set of named values.' }],
    };
  }

  const record = values as Record<string, unknown>;

  for (const field of settingsFieldsFor(providerIdentifier)) {
    const raw = Object.hasOwn(record, field.key) ? record[field.key] : undefined;
    const issue = checkField(field, raw, mode);

    if (issue) {
      issues.push({ key: field.key, message: issue });
    } else if (isSet(raw)) {
      accepted[field.key] = raw;
    }
  }

  return { values: accepted, issues };
}

/**
 * Tags' combined length as YouTube counts it toward its 500: each tag's
 * characters, plus two for a tag containing a space, which YouTube wraps in
 * quotes. Postiz counts it the same way.
 */
export function tagsTotalLength(tags: string[]): number {
  return tags.reduce((total, tag) => total + tag.length + (/\s/.test(tag) ? 2 : 0), 0);
}

function isSet(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  return typeof value !== 'string' || value.trim().length > 0;
}

function checkField(field: SettingField, raw: unknown, mode: 'draft' | 'queue'): string | null {
  if (!isSet(raw)) {
    return mode === 'queue' && field.kind === 'text' && field.required
      ? `${field.label} is required.`
      : null;
  }

  switch (field.kind) {
    case 'text': {
      if (typeof raw !== 'string') {
        return `${field.label} must be text.`;
      }
      if (field.maxLength !== undefined && raw.length > field.maxLength) {
        return `${field.label} must be at most ${field.maxLength} characters.`;
      }
      if (field.minLength !== undefined && raw.trim().length < field.minLength) {
        return `${field.label} must be at least ${field.minLength} characters.`;
      }
      if (field.url && !isSafeHref(raw.trim())) {
        return `${field.label} must be a link starting with http:// or https://.`;
      }
      return null;
    }

    case 'select':
      return typeof raw === 'string' && field.options.some((option) => option.value === raw)
        ? null
        : `${field.label} must be one of: ${field.options.map((option) => option.label).join(', ')}.`;

    case 'boolean':
      return typeof raw === 'boolean' ? null : `${field.label} must be on or off.`;

    case 'tags': {
      if (!Array.isArray(raw) || raw.some((tag) => typeof tag !== 'string')) {
        return `${field.label} must be a list of words.`;
      }
      if (raw.some((tag) => tag.trim().length === 0)) {
        return `${field.label} can't include an empty tag.`;
      }
      if (raw.length > field.max) {
        return `${field.label} can have at most ${field.max}.`;
      }
      if (field.maxTotalLength !== undefined && tagsTotalLength(raw) > field.maxTotalLength) {
        return `${field.label} can be at most ${field.maxTotalLength} characters in total.`;
      }
      return null;
    }
  }
}
