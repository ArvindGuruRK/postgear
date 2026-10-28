/**
 * Triggers: what starts a run. A trigger's output is the `trigger` root of
 * data tokens (`{{ trigger.post.url }}`). Triggers take no input, cannot be
 * turned off and have no On Error setting.
 */
import { z } from 'zod';
import { scheduleConfigSchema } from '../schedule/schema';
import { channelFields, channelIdsField, channelNames, count } from './fields';
import { PUBLISH_FAILURE_REASON_IDS, PUBLISH_FAILURE_REASONS } from './platforms';
import { defineNode, type OutputField } from './types';

const TRIGGER_BASICS = {
  typeVersion: 1,
  category: 'trigger',
  family: 'yellow',
  inputs: [],
  outputs: [{ id: 'out', label: 'Out' }],
  sideEffect: 'none',
  retry: 'none',
  timeoutClass: 'fast',
  canDisable: false,
  canHandleErrors: false,
} as const;

const POST_FIELDS: OutputField[] = [
  { path: 'post', label: 'Post', type: 'object' },
  { path: 'post.id', label: 'Post Id', type: 'text', sample: 'pst_3k9f2a' },
  { path: 'post.url', label: 'Post Link', type: 'text', sample: 'https://instagram.com/p/Cx1' },
  {
    path: 'post.preview',
    label: 'Post Text',
    type: 'text',
    sample: 'Fresh sourdough is out of the oven. Come early!',
  },
  { path: 'post.publishAt', label: 'Publish Time', type: 'date', sample: '2026-11-03T09:00:00Z' },
  { path: 'post.state', label: 'Post Status', type: 'text', sample: 'PUBLISHED' },
  ...channelFields('post.channel', 'Channel'),
  { path: 'tags', label: 'Tags', type: 'list', of: 'text', sample: ['launch', 'bakery'] },
  {
    path: 'link',
    label: 'PostGear Link',
    type: 'text',
    sample: 'https://postgear.rkay.in/org/posts/pst_3k9f2a',
  },
];

const postPublishedConfig = z
  .object({
    /** Only posts on these channels; empty means any channel. */
    channels: channelIdsField(50),
    /** Only posts with any of these tag ids; empty means any post. */
    tags: z.array(z.string().min(1).max(64)).max(20),
  })
  .strict();

export const postPublished = defineNode({
  ...TRIGGER_BASICS,
  type: 'trigger.postPublished',
  title: 'Post Published',
  description: 'Starts when a post goes live on a channel.',
  keywords: ['published', 'live', 'posted', 'new post'],
  icon: 'post-published',
  status: 'ready',
  priority: 'P0',
  configSchema: postPublishedConfig,
  defaultConfig: { channels: [], tags: [] },
  outputShape: [
    ...POST_FIELDS,
    { path: 'publishedAt', label: 'Published At', type: 'date', sample: '2026-11-03T09:00:12Z' },
  ],
  channels: 'filter',
  summary: (config, ctx) => {
    const where = config.channels.length ? channelNames(config.channels, ctx) : 'Any channel';
    return config.tags.length ? `${where}, ${count(config.tags.length, 'tag')}` : where;
  },
});

const postFailedConfig = z
  .object({
    channels: channelIdsField(50),
    /** Only these failure reasons; empty means any reason. */
    reasons: z.array(z.enum(PUBLISH_FAILURE_REASON_IDS)).max(PUBLISH_FAILURE_REASON_IDS.length),
  })
  .strict();

export const postFailed = defineNode({
  ...TRIGGER_BASICS,
  type: 'trigger.postFailed',
  title: 'Post Failed',
  description: 'Starts when a post could not be published.',
  keywords: ['failed', 'error', 'alert', 'problem'],
  icon: 'post-failed',
  status: 'ready',
  priority: 'P0',
  configSchema: postFailedConfig,
  defaultConfig: { channels: [], reasons: [] },
  outputShape: [
    ...POST_FIELDS,
    { path: 'error', label: 'Problem', type: 'object' },
    { path: 'error.reason', label: 'Reason Code', type: 'text', sample: 'needs_reconnect' },
    {
      path: 'error.reasonText',
      label: 'Reason',
      type: 'text',
      sample: PUBLISH_FAILURE_REASONS[0].label,
    },
    {
      path: 'error.message',
      label: 'Error Message',
      type: 'text',
      sample: 'Instagram asked PostGear to sign in again.',
    },
    { path: 'error.attempts', label: 'Attempts', type: 'number', sample: 3 },
  ],
  channels: 'filter',
  summary: (config, ctx) => {
    const where = config.channels.length ? channelNames(config.channels, ctx) : 'Any channel';
    if (config.reasons.length === 0) return `${where}, any reason`;
    if (config.reasons.length === 1) {
      const reason = PUBLISH_FAILURE_REASONS.find((r) => r.id === config.reasons[0]);
      return `${where}, ${reason?.label.toLowerCase() ?? '1 reason'}`;
    }
    return `${where}, ${count(config.reasons.length, 'reason')}`;
  },
});

const DAY_NAMES = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
} as const;

export const schedule = defineNode({
  ...TRIGGER_BASICS,
  type: 'trigger.schedule',
  title: 'Schedule',
  description: 'Starts at the times you choose, like every Monday at 09:00.',
  keywords: ['time', 'every', 'daily', 'weekly', 'recurring', 'timer'],
  icon: 'schedule',
  status: 'ready',
  priority: 'P0',
  configSchema: scheduleConfigSchema,
  defaultConfig: { frequency: 'weekly', days: ['mon'], time: '09:00', timeZone: 'UTC' },
  outputShape: [
    { path: 'scheduledFor', label: 'Scheduled Time', type: 'date', sample: '2026-11-03T09:00:00Z' },
    { path: 'timeZone', label: 'Time Zone', type: 'text', sample: 'Asia/Kolkata' },
  ],
  summary: (config) => {
    const at = config.time ? ` at ${config.time}` : '';
    switch (config.frequency) {
      case 'hourly':
        return config.everyHours && config.everyHours > 1
          ? `Every ${config.everyHours} hours`
          : 'Every hour';
      case 'daily':
        return `Every day${at}`;
      case 'weekdays':
        return `Every weekday${at}`;
      case 'weekly': {
        const days = (config.days ?? []).map((day) => DAY_NAMES[day]);
        const list =
          days.length > 1 ? `${days.slice(0, -1).join(', ')} and ${days.at(-1)}` : days[0];
        return `Every ${list ?? 'week'}${at}`;
      }
      case 'monthly':
        return config.dayOfMonth === 'last'
          ? `On the last day of every month${at}`
          : `On day ${config.dayOfMonth ?? 1} of every month${at}`;
    }
  },
});

const manualFieldSchema = z
  .object({
    key: z.string().regex(/^[a-z][A-Za-z0-9_]{0,31}$/, 'Use letters, numbers and _ only.'),
    label: z.string().trim().min(1, 'Give this field a label.').max(60),
    type: z.enum(['text', 'number', 'choice']),
    required: z.boolean().optional(),
    /** Choice fields only. */
    options: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  })
  .strict();

const manualConfig = z
  .object({ fields: z.array(manualFieldSchema).max(5) })
  .strict()
  .superRefine((config, issue) => {
    const keys = new Set<string>();
    config.fields.forEach((field, i) => {
      if (keys.has(field.key)) {
        issue.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fields', i, 'key'],
          message: 'Two fields share this name.',
        });
      }
      keys.add(field.key);
      if (field.type === 'choice' && !field.options?.length) {
        issue.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fields', i, 'options'],
          message: 'Add at least one choice.',
        });
      }
    });
  });

export const manual = defineNode({
  ...TRIGGER_BASICS,
  type: 'trigger.manual',
  title: 'Manual',
  description: 'Starts when you click Run Now, with optional fields to fill in.',
  keywords: ['run now', 'button', 'on demand', 'click'],
  icon: 'manual',
  status: 'ready',
  priority: 'P0',
  configSchema: manualConfig,
  defaultConfig: { fields: [] },
  outputShape: (config) => {
    const fields = Array.isArray(config.fields) ? config.fields : [];
    const inputs: OutputField[] = fields.flatMap((field) => {
      if (typeof field !== 'object' || field === null) return [];
      const { key, label, type } = field as { key?: unknown; label?: unknown; type?: unknown };
      if (typeof key !== 'string' || typeof label !== 'string') return [];
      return [{ path: `inputs.${key}`, label, type: type === 'number' ? 'number' : 'text' }];
    });
    return inputs.length ? [{ path: 'inputs', label: 'Inputs', type: 'object' }, ...inputs] : [];
  },
  summary: (config) =>
    config.fields.length
      ? `Run Now with ${count(config.fields.length, 'field')}`
      : 'Started with Run Now',
});

export const webhook = defineNode({
  ...TRIGGER_BASICS,
  type: 'trigger.webhook',
  title: 'Webhook',
  description: "Starts when another app sends data to this workflow's private link.",
  keywords: ['incoming', 'url', 'zapier', 'make', 'api', 'receive'],
  icon: 'webhook',
  status: 'ready',
  priority: 'P1',
  configSchema: z.object({}).strict(),
  defaultConfig: {},
  outputShape: [
    { path: 'body', label: 'Received Data', type: 'object', sample: { title: 'New blog post' } },
    { path: 'receivedAt', label: 'Received At', type: 'date', sample: '2026-11-03T09:00:00Z' },
  ],
  summary: () => 'When data arrives at its private link',
});

export const TRIGGER_NODES = [postPublished, postFailed, schedule, manual, webhook];
