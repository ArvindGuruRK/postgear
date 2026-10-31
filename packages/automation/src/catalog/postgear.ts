/**
 * Steps that act on PostGear itself: drafts, the queue, publishing and
 * reading a post. They run through the API's own post services (Module 10),
 * so every composer rule still applies. Publish To {Platform} lives here
 * too, shown in the library as one Social Channels card per platform.
 */
import { z } from 'zod';
import { timeZoneSchema } from '../schedule/schema';
import { channelIdsField, channelNames, isBlank, OUT, templateField, withArticle } from './fields';
import type { FieldSpec } from './form';
import { PUBLISH_PLATFORM_IDS, platformById } from './platforms';
import { defineNode, type OutputField } from './types';

const POSTGEAR_BASICS = {
  typeVersion: 1,
  family: 'ink',
  inputs: ['in'],
  outputs: OUT,
  timeoutClass: 'fast',
  canDisable: true,
  canHandleErrors: true,
} as const;

const CHANNEL_LIST: OutputField[] = [
  { path: 'channels', label: 'Channels', type: 'list', of: 'object' },
];

/** Media library items picked with Pick From Media (Module 10), next to the `media` template. */
const mediaIdsField = z.array(z.string().uuid()).max(10).optional();

const draftConfig = z
  .object({
    channels: channelIdsField(20),
    text: templateField(),
    /** A template that resolves to media from earlier steps (Generate Image). */
    media: templateField(500),
    mediaIds: mediaIdsField,
    /** Post tag ids; the composer takes at most 10. */
    tags: z.array(z.string().min(1).max(64)).max(10).optional(),
    /** `splitOnBlankLines` makes a thread: one part per paragraph. */
    parts: z.enum(['single', 'splitOnBlankLines']).optional(),
  })
  .strict();

type DraftConfig = z.infer<typeof draftConfig>;

const CHOOSE_CHANNELS = { path: 'channels', message: 'Choose at least one channel.' };
const WRITE_CONTENT = {
  path: 'text',
  message: 'Add the text or media to post.',
  when: (config: Pick<DraftConfig, 'media' | 'mediaIds'>) =>
    isBlank(config.media) && isBlank(config.mediaIds),
};

const CHANNELS_FIELD: FieldSpec = {
  path: 'channels',
  kind: 'channels',
  label: 'Channels',
  help: 'The post is written for these channels.',
  required: true,
};

const TEXT_FIELD: FieldSpec = {
  path: 'text',
  kind: 'longText',
  label: 'Text',
  help: 'Add text, media or both.',
  placeholder: 'Enter your post text',
  acceptsData: true,
};

const MEDIA_FIELD: FieldSpec = {
  path: 'media',
  kind: 'media',
  label: 'Media',
  help: 'Insert an image or video from an earlier step, like Generate Image, or pick one from your media library.',
  acceptsData: true,
  libraryPath: 'mediaIds',
};

const TAGS_FIELD: FieldSpec = { path: 'tags', kind: 'tags', label: 'Tags', emptyLabel: 'No tags' };

export const createDraft = defineNode({
  ...POSTGEAR_BASICS,
  type: 'postgear.createDraft',
  category: 'postgear',
  title: 'Create Draft',
  description: 'Saves a post to Drafts so you can review it in the composer.',
  keywords: ['draft', 'post', 'save', 'composer', 'write'],
  icon: 'draft',
  status: 'ready',
  priority: 'P0',
  configSchema: draftConfig,
  defaultConfig: { channels: [], text: '', media: '', mediaIds: [], tags: [], parts: 'single' },
  required: [CHOOSE_CHANNELS, WRITE_CONTENT],
  outputShape: [
    { path: 'postGroup', label: 'Post Group', type: 'text', sample: 'grp_7d2k' },
    {
      path: 'link',
      label: 'Draft Link',
      type: 'text',
      sample: 'https://postgear.rkay.in/org/composer?group=grp_7d2k',
    },
    ...CHANNEL_LIST,
    { path: 'text', label: 'Text', type: 'text', sample: 'Fresh sourdough is out of the oven.' },
    { path: 'mediaCount', label: 'Media Count', type: 'number', sample: 1 },
  ],
  sideEffect: 'internal',
  channels: 'act',
  retry: 'safe',
  summary: (config, ctx) =>
    config.channels.length
      ? `Draft for ${channelNames(config.channels, ctx)}`
      : 'Choose channels for the draft',
  form: {
    tabs: {
      setup: [{ ...CHANNELS_FIELD, help: 'The draft is written for these channels.' }],
      configure: [
        TEXT_FIELD,
        MEDIA_FIELD,
        {
          path: 'parts',
          kind: 'select',
          label: 'Post as',
          options: [
            { value: 'single', label: 'One post' },
            { value: 'splitOnBlankLines', label: 'A thread, one part per paragraph' },
          ],
        },
        TAGS_FIELD,
      ],
    },
    notes: ['A test run creates a real draft, so you can open it in the composer.'],
  },
});

const queueConfig = draftConfig
  .omit({ parts: true })
  .extend({
    when: z.enum(['nextSlot', 'at']),
    /** A template or an ISO date; `at` only. */
    at: templateField(200).optional(),
    timeZone: timeZoneSchema,
  })
  .strict();

export const addToQueue = defineNode({
  ...POSTGEAR_BASICS,
  type: 'postgear.addToQueue',
  category: 'postgear',
  title: 'Add To Queue',
  description: 'Queues a post for the next free posting time, or a time you set.',
  keywords: ['queue', 'schedule post', 'slot', 'later'],
  icon: 'queue',
  status: 'ready',
  priority: 'P1',
  configSchema: queueConfig,
  defaultConfig: {
    channels: [],
    text: '',
    media: '',
    mediaIds: [],
    tags: [],
    when: 'nextSlot',
    timeZone: 'UTC',
  },
  required: [
    CHOOSE_CHANNELS,
    WRITE_CONTENT,
    { path: 'at', message: 'Choose when to post.', when: (config) => config.when === 'at' },
  ],
  outputShape: [
    { path: 'postGroup', label: 'Post Group', type: 'text', sample: 'grp_7d2k' },
    { path: 'scheduledFor', label: 'Scheduled Time', type: 'date', sample: '2026-11-03T09:00:00Z' },
    ...CHANNEL_LIST,
  ],
  sideEffect: 'internal',
  // A queued post goes out on its own later, so it counts as publishing for
  // the activation tick and stays dry in tests (Module 10).
  publishes: true,
  channels: 'act',
  retry: 'safe',
  summary: (config, ctx) => {
    if (!config.channels.length) return 'Choose channels to queue for';
    const where = channelNames(config.channels, ctx);
    return config.when === 'nextSlot' ? `Next free time on ${where}` : `At a set time on ${where}`;
  },
  form: {
    tabs: {
      setup: [{ ...CHANNELS_FIELD, help: 'The post is queued on these channels.' }],
      configure: [
        TEXT_FIELD,
        MEDIA_FIELD,
        TAGS_FIELD,
        {
          path: 'when',
          kind: 'select',
          label: 'When to post',
          options: [
            { value: 'nextSlot', label: 'At the next free posting time' },
            { value: 'at', label: 'At a time I choose' },
          ],
        },
        {
          path: 'at',
          kind: 'text',
          label: 'Date and time',
          help: 'A date and time like 2026-11-03 09:00, or data from an earlier step.',
          placeholder: 'Enter your date and time',
          acceptsData: true,
          showIf: { path: 'when', equals: 'at' },
        },
        {
          path: 'timeZone',
          kind: 'timeZone',
          label: 'Time zone',
          help: 'Posting times and the date above are read in this time zone.',
        },
      ],
    },
    notes: [
      'With more than one channel, the post goes out at the first posting time free on all of them.',
      'Test runs only show what would be queued, unless you send this step for real.',
    ],
  },
});

const publishConfig = z
  .object({
    provider: z.enum(PUBLISH_PLATFORM_IDS),
    channels: channelIdsField(20),
    text: templateField(),
    media: templateField(500),
    mediaIds: mediaIdsField,
    /** The provider's own settings form (`settingsFieldsFor(provider)`). */
    settings: z.record(z.unknown()).optional(),
  })
  .strict();

export const publish = defineNode({
  ...POSTGEAR_BASICS,
  type: 'postgear.publish',
  category: 'social',
  family: 'platform',
  title: 'Publish To Channel',
  titleFor: (config) => `Publish To ${platformById(config.provider)?.title ?? 'Channel'}`,
  description: 'Publishes a post right away on one of your channels.',
  keywords: ['publish', 'post now', 'share', 'social', 'send post'],
  icon: 'publish',
  status: 'ready',
  priority: 'P1',
  configSchema: publishConfig,
  defaultConfig: { provider: 'instagram', channels: [], text: '', media: '', mediaIds: [] },
  required: [CHOOSE_CHANNELS, WRITE_CONTENT],
  outputShape: [
    { path: 'postGroup', label: 'Post Group', type: 'text', sample: 'grp_7d2k' },
    ...CHANNEL_LIST,
    { path: 'status', label: 'Status', type: 'text', sample: 'publishing' },
  ],
  sideEffect: 'internal',
  publishes: true,
  channels: 'act',
  retry: 'safe',
  summary: (config, ctx) => {
    if (config.channels.length) return `Publish now to ${channelNames(config.channels, ctx)}`;
    return `Choose ${withArticle(platformById(config.provider)?.title ?? 'social')} channel`;
  },
  form: {
    tabs: {
      setup: [
        {
          ...CHANNELS_FIELD,
          help: 'The post goes out on these channels.',
          providerPath: 'provider',
        },
      ],
      configure: [
        TEXT_FIELD,
        MEDIA_FIELD,
        {
          path: 'settings',
          kind: 'providerSettings',
          label: 'Platform settings',
          providerPath: 'provider',
        },
      ],
    },
    notes: [
      'This step starts publishing and moves on without waiting for the post to go live. To use the post link, build a separate workflow that starts on Post Published.',
      'Test runs only show what would be published, unless you send this step for real.',
    ],
  },
});

export const getPost = defineNode({
  ...POSTGEAR_BASICS,
  type: 'postgear.getPost',
  category: 'postgear',
  title: 'Get Post',
  description: 'Looks up a post and gives its text, media and channels to the next steps.',
  keywords: ['find', 'lookup', 'read', 'fetch post'],
  icon: 'post',
  status: 'ready',
  priority: 'P1',
  configSchema: z.object({ post: templateField(200) }).strict(),
  defaultConfig: { post: '' },
  required: [{ path: 'post', message: 'Choose which post to look up.' }],
  outputShape: [
    { path: 'id', label: 'Post Id', type: 'text', sample: 'pst_3k9f2a' },
    { path: 'group', label: 'Post Group', type: 'text', sample: 'grp_7d2k' },
    { path: 'state', label: 'Post Status', type: 'text', sample: 'PUBLISHED' },
    { path: 'text', label: 'Text', type: 'text', sample: 'Fresh sourdough is out of the oven.' },
    { path: 'mediaCount', label: 'Media Count', type: 'number', sample: 1 },
    { path: 'media', label: 'Media', type: 'list', of: 'media' },
    ...CHANNEL_LIST,
    { path: 'tags', label: 'Tags', type: 'list', of: 'text', sample: ['bakery'] },
    { path: 'publishDate', label: 'Publish Time', type: 'date', sample: '2026-11-03T09:00:00Z' },
    {
      path: 'releaseUrl',
      label: 'Post Link',
      type: 'text',
      sample: 'https://instagram.com/p/Cx1',
    },
  ],
  sideEffect: 'none',
  retry: 'safe',
  summary: (config) => (isBlank(config.post) ? 'Choose a post' : 'Looks up a post'),
  form: {
    tabs: {
      setup: [],
      configure: [
        {
          path: 'post',
          kind: 'text',
          label: 'Post',
          help: 'Usually the post that started this workflow, from its trigger data.',
          placeholder: 'Enter your post id',
          acceptsData: true,
          required: true,
        },
      ],
    },
  },
});

export const POSTGEAR_NODES = [createDraft, addToQueue, publish, getPost];
