/**
 * Per-platform post settings: what each provider offers, and the one
 * validator the API runs on a save (and the composer may run as you type).
 */
import {
  PROVIDER_SETTINGS,
  settingsFieldsFor,
  tagsTotalLength,
  validateProviderSettings,
} from './settings';

describe('settingsFieldsFor', () => {
  it('lists each provider’s fields in display order', () => {
    expect(settingsFieldsFor('youtube').map((field) => field.key)).toEqual([
      'title',
      'privacyStatus',
      'madeForKids',
      'tags',
    ]);
    expect(settingsFieldsFor('tiktok').map((field) => field.key)).toEqual([
      'privacyLevel',
      'disableComment',
      'disableDuet',
      'disableStitch',
    ]);
    expect(settingsFieldsFor('pinterest').map((field) => field.key)).toEqual(['title', 'link']);
    expect(settingsFieldsFor('x').map((field) => field.key)).toEqual(['replySettings']);
    expect(settingsFieldsFor('facebook').map((field) => field.key)).toEqual(['link']);
  });

  it('has nothing for providers that take no options, or that do not exist', () => {
    for (const identifier of ['instagram', 'linkedin', 'linkedin-page', 'mastodon', 'toString']) {
      expect(settingsFieldsFor(identifier)).toEqual([]);
    }
    expect(Object.keys(PROVIDER_SETTINGS).sort()).toEqual([
      'facebook',
      'pinterest',
      'tiktok',
      'x',
      'youtube',
    ]);
  });

  it('gives every select a default that is one of its own options', () => {
    for (const fields of Object.values(PROVIDER_SETTINGS)) {
      for (const field of fields) {
        if (field.kind === 'select') {
          expect(field.options.map((option) => option.value)).toContain(field.default);
        }
      }
    }
  });
});

describe('validateProviderSettings', () => {
  it('keeps valid values and drops keys the provider does not read', () => {
    expect(
      validateProviderSettings(
        'youtube',
        {
          title: 'Launch day',
          privacyStatus: 'unlisted',
          madeForKids: false,
          tags: ['launch'],
          customized: true,
          categoryId: '10',
        },
        'queue',
      ),
    ).toEqual({
      values: {
        title: 'Launch day',
        privacyStatus: 'unlisted',
        madeForKids: false,
        tags: ['launch'],
      },
      issues: [],
    });
  });

  it('drops everything for a provider without settings, without complaint', () => {
    expect(validateProviderSettings('instagram', { title: 'x' }, 'queue')).toEqual({
      values: {},
      issues: [],
    });
  });

  it('treats undefined, null and blank text as unset', () => {
    expect(validateProviderSettings('pinterest', { title: '   ', link: null }, 'queue')).toEqual({
      values: {},
      issues: [],
    });
    expect(validateProviderSettings('x', undefined, 'draft')).toEqual({ values: {}, issues: [] });
    expect(validateProviderSettings('x', null, 'draft')).toEqual({ values: {}, issues: [] });
  });

  it('coerces nothing: a value of the wrong type is an issue, named by its label', () => {
    const { values, issues } = validateProviderSettings(
      'tiktok',
      { privacyLevel: 'EVERYONE', disableComment: 'true', disableDuet: 1, disableStitch: true },
      'draft',
    );

    expect(values).toEqual({ disableStitch: true });
    expect(issues).toEqual([
      {
        key: 'privacyLevel',
        message: 'Who can see this video must be one of: Everyone, Friends, Followers, Only me.',
      },
      { key: 'disableComment', message: 'Turn off comments must be on or off.' },
      { key: 'disableDuet', message: 'Turn off Duet must be on or off.' },
    ]);
  });

  it('holds text to its length and links to http and https, in drafts too', () => {
    expect(validateProviderSettings('youtube', { title: 'x'.repeat(101) }, 'draft').issues).toEqual(
      [{ key: 'title', message: 'Title must be at most 100 characters.' }],
    );
    expect(
      validateProviderSettings('pinterest', { link: 'javascript:alert(1)' }, 'draft').issues,
    ).toEqual([
      {
        key: 'link',
        message: 'Destination link must be a link starting with http:// or https://.',
      },
    ]);
    expect(validateProviderSettings('facebook', { link: 42 }, 'draft').issues).toEqual([
      { key: 'link', message: 'Link must be text.' },
    ]);
    expect(validateProviderSettings('facebook', { link: 'https://acme.test/a' }, 'queue')).toEqual({
      values: { link: 'https://acme.test/a' },
      issues: [],
    });
  });

  it('holds YouTube tags to their count and YouTube’s total, quotes included', () => {
    const tooMany = Array.from({ length: 16 }, (_, index) => `tag${index}`);
    expect(validateProviderSettings('youtube', { tags: tooMany }, 'draft').issues).toEqual([
      { key: 'tags', message: 'Tags can have at most 15.' },
    ]);

    // 14 tags of 34 characters with a space: 14 × (34 + 2) = 504.
    const long = Array.from(
      { length: 14 },
      (_, index) => `${'a'.repeat(31)} ${String(index).padStart(2, '0')}`,
    );
    expect(tagsTotalLength(long)).toBe(504);
    expect(validateProviderSettings('youtube', { tags: long }, 'draft').issues).toEqual([
      { key: 'tags', message: 'Tags can be at most 500 characters in total.' },
    ]);

    expect(validateProviderSettings('youtube', { tags: ['ok', '  '] }, 'draft').issues).toEqual([
      { key: 'tags', message: "Tags can't include an empty tag." },
    ]);
    expect(validateProviderSettings('youtube', { tags: 'launch' }, 'draft').issues).toEqual([
      { key: 'tags', message: 'Tags must be a list of words.' },
    ]);
  });

  it('checks required fields only when queueing', () => {
    // No listed field is required today; the rule is the validator's, so it
    // is pinned on a field shaped like one.
    const original = PROVIDER_SETTINGS.pinterest;
    PROVIDER_SETTINGS.pinterest = [
      { key: 'title', label: 'Pin title', kind: 'text', required: true },
    ];

    try {
      expect(validateProviderSettings('pinterest', {}, 'draft').issues).toEqual([]);
      expect(validateProviderSettings('pinterest', { title: ' ' }, 'queue').issues).toEqual([
        { key: 'title', message: 'Pin title is required.' },
      ]);
    } finally {
      PROVIDER_SETTINGS.pinterest = original;
    }
  });

  it('refuses settings that are not an object at all', () => {
    expect(validateProviderSettings('x', ['everyone'], 'draft').issues).toHaveLength(1);
    expect(validateProviderSettings('x', 'everyone', 'draft').values).toEqual({});
  });
});
