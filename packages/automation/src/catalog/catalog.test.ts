import { ZodEffects, type ZodTypeAny } from 'zod';
import { step } from '../testing/builders';
import {
  AI_STEP_CREDITS,
  CONNECTION_KINDS,
  describeNode,
  EXECUTABLE_TYPES,
  getDefinition,
  isNodeType,
  listDefinitions,
  NODE_CATALOG,
  NODE_TYPES,
  nodeTitle,
  outputFieldsOf,
  outputPortsOf,
  PUBLISH_FAILURE_REASONS,
  PUBLISH_PLATFORMS,
  parseNodeConfig,
} from './index';

/**
 * The Title Case rule of `apps/web/src/lib/title-case.test.ts`, copied
 * (packages cannot import the web app): every word that starts with a
 * letter starts with a capital.
 */
function isTitleCase(text: string): boolean {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => {
      const first = word.replace(/^[^A-Za-z0-9]+/, '')[0];
      if (!first || !/[A-Za-z]/.test(first)) return true;
      return first === first.toUpperCase();
    });
}

/** A sentence: a capital first, a full stop last, and not every word capitalised. */
function isSentence(text: string): boolean {
  const words = text.split(/\s+/).slice(1);
  return /^[A-Z]/.test(text) && /\.$/.test(text) && words.some((word) => /^[a-z]/.test(word));
}

function shapeKeys(schema: ZodTypeAny): string[] {
  const inner = schema instanceof ZodEffects ? schema.innerType() : schema;
  return Object.keys((inner as unknown as { shape: Record<string, unknown> }).shape);
}

describe('the node catalog', () => {
  it('declares every node type exactly once', () => {
    const types = NODE_CATALOG.map((def) => def.type);
    expect(new Set(types).size).toBe(types.length);
    expect([...types].sort()).toEqual([...NODE_TYPES].sort());
  });

  it.each(NODE_CATALOG.map((def) => [def.type, def] as const))(
    '%s: its default config passes its own schema',
    (_type, def) => {
      expect(def.configSchema.safeParse(def.defaultConfig).success).toBe(true);
    },
  );

  it.each(NODE_CATALOG.map((def) => [def.type, def] as const))(
    '%s: title is Title Case and the description is one sentence',
    (_type, def) => {
      expect(isTitleCase(def.title)).toBe(true);
      expect(isSentence(def.description)).toBe(true);
      for (const port of typeof def.outputs === 'function' ? [] : def.outputs) {
        expect(isTitleCase(port.label)).toBe(true);
      }
      const fields =
        typeof def.outputShape === 'function' ? def.outputShape({}) : [...def.outputShape];
      for (const field of fields) expect(isTitleCase(field.label)).toBe(true);
    },
  );

  it('gives every Coming Soon step a reason, and only those', () => {
    for (const def of NODE_CATALOG) {
      if (def.status === 'comingSoon') expect(def.comingSoonReason).toMatch(/coming soon\.$/);
      else expect(def.comingSoonReason).toBeUndefined();
    }
    expect(listDefinitions({ status: 'comingSoon' }).map((def) => def.type)).toEqual([
      'ai.generateVideo',
      'studio.renderDesign',
      'notify.whatsapp',
      'data.excelAppendRow',
    ]);
  });

  it('keeps triggers inputless, never off, and without an On Error setting', () => {
    for (const def of listDefinitions({ category: 'trigger' })) {
      expect(def.inputs).toEqual([]);
      expect(def.canDisable).toBe(false);
      expect(def.canHandleErrors).toBe(false);
      expect(def.family).toBe('yellow');
    }
  });

  it('cannot turn off steps that decide or join branches', () => {
    for (const type of ['logic.ifElse', 'logic.switch', 'logic.manualReview', 'logic.merge']) {
      expect(getDefinition(type)?.canDisable).toBe(false);
    }
    expect(getDefinition('logic.manualReview')?.canHandleErrors).toBe(false);
  });

  it('lists required and connection fields that exist in each schema', () => {
    for (const def of NODE_CATALOG) {
      const keys = shapeKeys(def.configSchema as ZodTypeAny);
      for (const required of def.required ?? []) {
        expect(keys).toContain(required.path.split('.')[0]);
        expect(isSentence(required.message)).toBe(true);
      }
      if (def.connection) expect(keys).toContain(def.connection.field);
    }
  });

  it('marks outside apps external, and publishing steps as publishing', () => {
    const external = listDefinitions()
      .filter((def) => def.sideEffect === 'external')
      .map((def) => def.type);
    expect(external).toEqual([
      'notify.slack',
      'notify.teams',
      'notify.discord',
      'notify.email',
      'notify.whatsapp',
      'data.googleSheetsAppendRow',
      'data.excelAppendRow',
      'data.httpRequest',
    ]);
    const publishing = NODE_CATALOG.filter((def) => def.publishes).map((def) => def.type);
    expect(publishing).toEqual(['postgear.addToQueue', 'postgear.publish']);
  });

  it('gives AI and Studio steps the slow timeout and everything else the fast one', () => {
    for (const def of NODE_CATALOG) {
      const slow = def.category === 'ai';
      expect(def.timeoutClass).toBe(slow ? 'slow' : 'fast');
    }
  });

  it('prices AI steps from the credit table', () => {
    const credits = (type: string, config: Record<string, unknown> = {}) => {
      const def = getDefinition(type);
      return def?.credits?.({ ...def.defaultConfig, ...config });
    };
    expect(credits('ai.generateText')).toBe(AI_STEP_CREDITS.text);
    expect(credits('ai.generateText', { withImage: true })).toBe(
      AI_STEP_CREDITS.text + AI_STEP_CREDITS.image,
    );
    expect(credits('ai.generateImage')).toBe(10);
    expect(credits('ai.generateHashtags')).toBe(2);
    expect(credits('ai.rewriteInBrandVoice')).toBe(2);
    expect(credits('notify.slack')).toBeUndefined();
  });

  it('finds Google Sheets and Excel when searching for excel', () => {
    const hits = NODE_CATALOG.filter((def) => def.keywords.includes('excel')).map((d) => d.type);
    expect(hits).toEqual(['data.googleSheetsAppendRow', 'data.excelAppendRow']);
  });

  it('runs only ready steps, and the run engine has every trigger and logic step', () => {
    for (const type of EXECUTABLE_TYPES) {
      expect(getDefinition(type)?.status).toBe('ready');
    }
    for (const definition of listDefinitions()) {
      if (definition.category === 'trigger' || definition.category === 'logic') {
        expect(EXECUTABLE_TYPES.has(definition.type)).toBe(true);
      }
    }
  });

  it('has one Social Channels card per platform and the seven failure reasons', () => {
    expect(PUBLISH_PLATFORMS.map((platform) => platform.title)).toEqual([
      'Instagram',
      'Facebook',
      'X',
      'LinkedIn',
      'YouTube',
      'TikTok',
      'Pinterest',
    ]);
    expect(PUBLISH_FAILURE_REASONS).toHaveLength(7);
    expect(CONNECTION_KINDS.map((kind) => kind.kind)).toEqual([
      'slack',
      'teams',
      'discord',
      'google',
      'http',
    ]);
  });
});

describe('looking up definitions', () => {
  it('finds a type, and refuses an unknown type or version', () => {
    expect(getDefinition('notify.slack')?.title).toBe('Slack');
    expect(getDefinition('notify.slack', 1)?.title).toBe('Slack');
    expect(getDefinition('notify.slack', 2)).toBeUndefined();
    expect(getDefinition('notify.pager')).toBeUndefined();
    expect(isNodeType('logic.merge')).toBe(true);
    expect(isNodeType('logic.loop')).toBe(false);
  });

  it('filters the library by category', () => {
    expect(listDefinitions({ category: 'social' }).map((def) => def.type)).toEqual([
      'postgear.publish',
    ]);
    expect(listDefinitions()).toHaveLength(NODE_CATALOG.length);
  });

  it('names a new Publish step after its platform', () => {
    expect(nodeTitle('postgear.publish', { ...step('p1', 'postgear.publish').config })).toBe(
      'Publish To Instagram',
    );
    expect(
      nodeTitle('postgear.publish', {
        ...step('p1', 'postgear.publish').config,
        provider: 'linkedin',
      }),
    ).toBe('Publish To LinkedIn');
    expect(nodeTitle('postgear.publish')).toBe('Publish To Channel');
    expect(nodeTitle('notify.slack', {})).toBe('Slack');
    expect(nodeTitle('nope.nope')).toBe('Step');
  });

  it('parses a step config with its type schema', () => {
    expect(parseNodeConfig(step('s1', 'notify.slack'))?.success).toBe(true);
    expect(parseNodeConfig({ ...step('s1', 'notify.slack'), config: { x: 1 } })?.success).toBe(
      false,
    );
    expect(parseNodeConfig({ ...step('s1', 'notify.slack'), type: 'nope.nope' })).toBeUndefined();
  });
});

describe('ports and output fields of a step', () => {
  it('gives If / Else True and False, and Manual Review Approved and Rejected', () => {
    expect(outputPortsOf(step('i1', 'logic.ifElse')).map((p) => p.label)).toEqual([
      'True',
      'False',
    ]);
    expect(outputPortsOf(step('r1', 'logic.manualReview')).map((p) => p.id)).toEqual([
      'approved',
      'rejected',
    ]);
  });

  it('gives Paths one port per case, then Otherwise, from an unfinished config too', () => {
    const paths = step('p1', 'logic.switch', {
      config: {
        cases: [
          { id: 'big', name: 'Big Posts', condition: { match: 'all', rules: [] } },
          { id: 'small', name: '', condition: { match: 'all', rules: [] } },
          { id: 'big', name: 'Again', condition: { match: 'all', rules: [] } },
          'junk',
        ],
      },
    });
    expect(outputPortsOf(paths)).toEqual([
      { id: 'case:big', label: 'Big Posts' },
      { id: 'case:small', label: 'Path' },
      { id: 'fallback', label: 'Otherwise' },
    ]);
    expect(outputPortsOf({ ...paths, config: { cases: 'nope' } })).toEqual([
      { id: 'fallback', label: 'Otherwise' },
    ]);
  });

  it('adds an On Error port only for the branch mode, and never to a trigger', () => {
    const slack = step('s1', 'notify.slack');
    expect(outputPortsOf({ ...slack, onError: { mode: 'branch' } }).map((p) => p.id)).toEqual([
      'out',
      'error',
    ]);
    expect(outputPortsOf({ ...slack, onError: { mode: 'continue' } }).map((p) => p.id)).toEqual([
      'out',
    ]);
    const trigger = step('t1', 'trigger.manual', { onError: { mode: 'branch' } });
    expect(outputPortsOf(trigger).map((p) => p.id)).toEqual(['out']);
    expect(outputPortsOf({ ...slack, type: 'nope.nope' })).toEqual([]);
  });

  it('lists error fields for steps that carry on after a failure', () => {
    const slack = step('s1', 'notify.slack');
    const paths = (onError?: 'stop' | 'continue' | 'branch') =>
      outputFieldsOf({ ...slack, onError: onError && { mode: onError } }).map((f) => f.path);
    expect(paths()).not.toContain('error.message');
    expect(paths('stop')).not.toContain('error.message');
    expect(paths('continue')).toContain('error.message');
    expect(paths('branch')).toContain('error.code');
    expect(outputFieldsOf({ ...slack, type: 'nope.nope' })).toEqual([]);
  });

  it('builds Set Fields and Manual outputs from their config', () => {
    const set = step('f1', 'logic.setFields', {
      config: {
        fields: [
          { name: 'date', type: 'text', value: '' },
          { name: 'count', type: 'number', value: '1' },
          { name: 'bad name', type: 'text', value: '' },
          null,
        ],
      },
    });
    expect(outputFieldsOf(set)).toEqual([
      { path: 'date', label: 'date', type: 'text' },
      { path: 'count', label: 'count', type: 'number' },
    ]);
    const manual = step('m1', 'trigger.manual', {
      config: {
        fields: [
          { key: 'topic', label: 'Topic', type: 'text' },
          { key: 'n', label: 'How Many', type: 'number' },
          { label: 'No Key' },
          7,
        ],
      },
    });
    expect(outputFieldsOf(manual).map((f) => [f.path, f.type])).toEqual([
      ['inputs', 'object'],
      ['inputs.topic', 'text'],
      ['inputs.n', 'number'],
    ]);
    expect(outputFieldsOf(step('m2', 'trigger.manual'))).toEqual([]);
  });
});

describe('step summaries', () => {
  const ctx = {
    channels: [
      { id: 'ch_ig', name: 'Bloom Bakery', provider: 'instagram' },
      { id: 'ch_fb', name: 'Bloom Page', provider: 'facebook' },
      { id: 'ch_x', name: 'Bloom X', provider: 'x' },
    ],
    connections: [{ id: 'conn_slack', name: 'Marketing Slack', kind: 'slack' as const }],
  };
  const say = (type: Parameters<typeof step>[1], config: Record<string, unknown> = {}) =>
    describeNode(step('n1', type, { config }), ctx);

  it('summarises every default step in one sentence-case line, without throwing', () => {
    for (const def of NODE_CATALOG) {
      const summary = describeNode(step('n1', def.type));
      expect(summary).toMatch(/^[A-Z0-9]/);
      expect(summary).not.toMatch(/\n/);
    }
  });

  it('describes triggers the way the card shows them', () => {
    expect(say('trigger.postPublished')).toBe('Any channel');
    expect(say('trigger.postPublished', { channels: ['ch_ig', 'ch_fb'] })).toBe(
      'Bloom Bakery, Bloom Page',
    );
    expect(
      say('trigger.postPublished', { channels: ['ch_ig', 'ch_fb', 'ch_x'], tags: ['t'] }),
    ).toBe('Bloom Bakery, Bloom Page +1, 1 tag');
    expect(say('trigger.postPublished', { channels: ['ch_gone'] })).toBe('1 channel');
    expect(say('trigger.postFailed')).toBe('Any channel, any reason');
    expect(say('trigger.postFailed', { reasons: ['needs_reconnect'] })).toBe(
      'Any channel, channel needs reconnecting',
    );
    expect(say('trigger.postFailed', { reasons: ['rejected', 'interrupted'] })).toBe(
      'Any channel, 2 reasons',
    );
    expect(say('trigger.manual')).toBe('Started with Run Now');
    expect(say('trigger.manual', { fields: [{ key: 'a', label: 'A', type: 'text' }] })).toBe(
      'Run Now with 1 field',
    );
  });

  it('describes schedules in plain words', () => {
    expect(say('trigger.schedule')).toBe('Every Monday at 09:00');
    expect(say('trigger.schedule', { days: ['mon', 'wed', 'fri'] })).toBe(
      'Every Monday, Wednesday and Friday at 09:00',
    );
    expect(say('trigger.schedule', { frequency: 'hourly', everyHours: 1 })).toBe('Every hour');
    expect(say('trigger.schedule', { frequency: 'hourly', everyHours: 3 })).toBe('Every 3 hours');
    expect(say('trigger.schedule', { frequency: 'daily', time: '18:30' })).toBe(
      'Every day at 18:30',
    );
    expect(say('trigger.schedule', { frequency: 'weekdays' })).toBe('Every weekday at 09:00');
    expect(say('trigger.schedule', { frequency: 'monthly', dayOfMonth: 5 })).toBe(
      'On the 5th of every month at 09:00',
    );
    expect(say('trigger.schedule', { frequency: 'monthly', dayOfMonth: 'last' })).toBe(
      'On the last day of every month at 09:00',
    );
  });

  it('describes action steps by what they will do', () => {
    expect(say('notify.slack')).toBe('Choose a Slack connection');
    expect(say('notify.slack', { connectionId: 'conn_slack' })).toBe('Message to Marketing Slack');
    expect(say('postgear.createDraft', { channels: ['ch_ig'] })).toBe('Draft for Bloom Bakery');
    expect(say('postgear.addToQueue', { channels: ['ch_ig'] })).toBe(
      'Next free time on Bloom Bakery',
    );
    expect(say('postgear.addToQueue', { channels: ['ch_ig'], when: 'at', at: 'x' })).toBe(
      'At a set time on Bloom Bakery',
    );
    expect(say('postgear.publish')).toBe('Choose an Instagram channel');
    expect(say('postgear.publish', { provider: 'tiktok' })).toBe('Choose a TikTok channel');
    expect(say('postgear.publish', { channels: ['ch_ig'] })).toBe('Publish now to Bloom Bakery');
    expect(say('ai.generateText')).toBe('Post for any platform, company voice');
    expect(say('ai.generateText', { platform: 'linkedin', format: 'thread_long' })).toBe(
      'Thread for LinkedIn, company voice',
    );
    expect(say('ai.generateHashtags', { count: 8, platform: 'x' })).toBe('8 hashtags for X');
    expect(say('logic.delay', { amount: 2, unit: 'days' })).toBe('Waits 2 days');
    expect(say('logic.delay', { mode: 'until', until: 'x' })).toBe('Waits until a set time');
    expect(say('logic.switch')).toBe('2 paths and Otherwise');
    expect(say('notify.email', { to: ['a@b.co', 'c@d.co'] })).toBe('Emails 2 people');
    expect(say('data.httpRequest', { url: 'https://api.example.com/hooks?x=1' })).toBe(
      'POST to api.example.com',
    );
    expect(say('data.httpRequest', { url: '{{ trigger.body.url }}', method: 'GET' })).toBe(
      'GET request',
    );
    expect(
      say('data.googleSheetsAppendRow', { spreadsheet: { id: '1', name: 'Social Report' } }),
    ).toBe('Adds a row to Social Report');
  });

  it('falls back to a plain sentence for unknown types, Coming Soon and unfinished config', () => {
    expect(describeNode({ ...step('n1', 'notify.slack'), type: 'nope.nope' })).toBe(
      'This step type is not available any more.',
    );
    expect(say('notify.whatsapp')).toBe('WhatsApp is coming soon.');
    expect(describeNode({ ...step('n1', 'notify.slack'), config: { footer: 'yes' } })).toBe(
      'Finish setting up this step',
    );
  });
});
