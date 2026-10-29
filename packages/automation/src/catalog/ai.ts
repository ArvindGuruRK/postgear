/**
 * AI steps. They run through the API's AI services and charge the
 * workspace's credits (Module 11), so they count as an internal side
 * effect and take the slow timeout class: model calls can take a minute.
 */
import { z } from 'zod';
import { count, isBlank, OUT, templateField } from './fields';
import { PUBLISH_PLATFORM_IDS, platformById } from './platforms';
import { defineNode, type OutputField } from './types';

/**
 * Credits per run. These must equal `AI_CREDIT_COSTS` in
 * `apps/api/src/modules/ai/credits/credits.policy.ts` (generate_post,
 * generate_image, and Module 11's generate_snippet); Module 11 tests it.
 */
export const AI_STEP_CREDITS = { text: 5, image: 10, snippet: 2 } as const;

const AI_BASICS = {
  typeVersion: 1,
  category: 'ai',
  family: 'violet',
  inputs: ['in'],
  outputs: OUT,
  sideEffect: 'internal',
  retry: 'transient',
  timeoutClass: 'slow',
  canDisable: true,
  canHandleErrors: true,
} as const;

const platformField = z.enum(['generic', ...PUBLISH_PLATFORM_IDS]);
const voiceField = z.enum(['personal', 'company']);

function platformWords(platform: string): string {
  return platform === 'generic' ? 'any platform' : (platformById(platform)?.title ?? platform);
}

const IMAGE_FIELDS: OutputField[] = [
  { path: 'image', label: 'Image', type: 'media' },
  {
    path: 'url',
    label: 'Image Link',
    type: 'text',
    sample: 'https://media.postgear.local/i/1.png',
  },
  { path: 'alt', label: 'Image Description', type: 'text', sample: 'A loaf of sourdough bread' },
];

const textConfig = z
  .object({
    prompt: templateField(4_000),
    platform: platformField,
    voice: voiceField,
    format: z.enum(['one_short', 'one_long', 'thread_short', 'thread_long']),
    research: z.boolean(),
    withImage: z.boolean(),
  })
  .strict();

export const generateText = defineNode({
  ...AI_BASICS,
  type: 'ai.generateText',
  title: 'Generate Text',
  description: 'Writes a post from your prompt, in your brand voice.',
  keywords: ['ai', 'write', 'copy', 'caption', 'gpt', 'content'],
  icon: 'sparkles',
  status: 'ready',
  priority: 'P0',
  configSchema: textConfig,
  defaultConfig: {
    prompt: '',
    platform: 'generic',
    voice: 'company',
    format: 'one_short',
    research: false,
    withImage: false,
  },
  required: [{ path: 'prompt', message: 'Write what the post should be about.' }],
  outputShape: [
    { path: 'text', label: 'Text', type: 'text', sample: 'Fresh sourdough, every morning.' },
    { path: 'parts', label: 'Thread Parts', type: 'list', of: 'text' },
    { path: 'hook', label: 'Hook', type: 'text', sample: 'Still warm at 7 am.' },
    { path: 'category', label: 'Category', type: 'text', sample: 'Product' },
    { path: 'sources', label: 'Sources', type: 'list', of: 'object' },
    { path: 'researched', label: 'Researched', type: 'boolean', sample: false },
    ...IMAGE_FIELDS.slice(0, 1),
  ],
  credits: (config) => AI_STEP_CREDITS.text + (config.withImage ? AI_STEP_CREDITS.image : 0),
  summary: (config) => {
    const what = config.format.startsWith('thread') ? 'Thread' : 'Post';
    const voice = config.voice === 'personal' ? 'personal voice' : 'company voice';
    return `${what} for ${platformWords(config.platform)}, ${voice}`;
  },
  form: {
    tabs: {
      setup: [],
      configure: [
        {
          path: 'prompt',
          kind: 'longText',
          label: 'Prompt',
          help: 'What the post should be about. Insert data to use earlier steps.',
          placeholder: 'Enter your prompt',
          acceptsData: true,
          required: true,
        },
        {
          path: 'platform',
          kind: 'select',
          label: 'Platform',
          options: [
            { value: 'generic', label: 'Any platform' },
            ...PUBLISH_PLATFORM_IDS.map((id) => ({ value: id, label: platformById(id)?.title ?? id })),
          ],
        },
        {
          path: 'voice',
          kind: 'select',
          label: 'Voice',
          options: [
            { value: 'company', label: 'Company' },
            { value: 'personal', label: 'Personal' },
          ],
        },
        {
          path: 'format',
          kind: 'select',
          label: 'Length',
          options: [
            { value: 'one_short', label: 'One short post' },
            { value: 'one_long', label: 'One long post' },
            { value: 'thread_short', label: 'A short thread' },
            { value: 'thread_long', label: 'A long thread' },
          ],
        },
        {
          path: 'research',
          kind: 'toggle',
          label: 'Web research',
          help: 'Looks up recent facts on the web before writing.',
        },
        {
          path: 'withImage',
          kind: 'toggle',
          label: 'Make an image too',
          help: 'Also makes an image to go with the post.',
        },
      ],
    },
  },
});

const IMAGE_STYLE_WORDS = {
  photo: 'A photo from your prompt',
  illustration: 'An illustration from your prompt',
  flat: 'A flat graphic from your prompt',
} as const;

const imageConfig = z
  .object({
    prompt: templateField(4_000),
    style: z.enum(['photo', 'illustration', 'flat']).optional(),
  })
  .strict();

export const generateImage = defineNode({
  ...AI_BASICS,
  type: 'ai.generateImage',
  title: 'Generate Image',
  description: 'Makes an image from your prompt and saves it to Media.',
  keywords: ['ai', 'picture', 'photo', 'illustration', 'dall-e', 'visual'],
  icon: 'image',
  status: 'ready',
  priority: 'P1',
  configSchema: imageConfig,
  defaultConfig: { prompt: '', style: 'photo' },
  required: [{ path: 'prompt', message: 'Describe the image to make.' }],
  outputShape: IMAGE_FIELDS,
  credits: () => AI_STEP_CREDITS.image,
  summary: (config) =>
    config.style ? IMAGE_STYLE_WORDS[config.style] : 'An image from your prompt',
});

const hashtagsConfig = z
  .object({
    text: templateField(),
    platform: platformField,
    count: z.number().int().min(3).max(15),
  })
  .strict();

export const generateHashtags = defineNode({
  ...AI_BASICS,
  type: 'ai.generateHashtags',
  title: 'Generate Hashtags',
  description: 'Suggests hashtags that fit a post.',
  keywords: ['ai', 'tags', 'hashtag', '#'],
  icon: 'hashtag',
  status: 'ready',
  priority: 'P1',
  configSchema: hashtagsConfig,
  defaultConfig: { text: '', platform: 'generic', count: 5 },
  required: [{ path: 'text', message: 'Choose the text to find hashtags for.' }],
  outputShape: [
    {
      path: 'hashtags',
      label: 'Hashtags',
      type: 'list',
      of: 'text',
      sample: ['#bakery', '#bread'],
    },
    { path: 'line', label: 'Hashtag Line', type: 'text', sample: '#bakery #bread #sourdough' },
  ],
  credits: () => AI_STEP_CREDITS.snippet,
  summary: (config) => `${count(config.count, 'hashtag')} for ${platformWords(config.platform)}`,
});

const rewriteConfig = z
  .object({ text: templateField(), platform: platformField, voice: voiceField })
  .strict();

export const rewriteInBrandVoice = defineNode({
  ...AI_BASICS,
  type: 'ai.rewriteInBrandVoice',
  title: 'Rewrite In Brand Voice',
  description: 'Rewrites text in your brand voice, sized for a platform.',
  keywords: ['ai', 'rewrite', 'repurpose', 'tone', 'voice', 'edit'],
  icon: 'wand',
  status: 'ready',
  priority: 'P1',
  configSchema: rewriteConfig,
  defaultConfig: { text: '', platform: 'generic', voice: 'company' },
  required: [{ path: 'text', message: 'Choose the text to rewrite.' }],
  outputShape: [
    { path: 'text', label: 'Text', type: 'text', sample: 'Our sourdough, your mornings.' },
  ],
  credits: () => AI_STEP_CREDITS.snippet,
  summary: (config) =>
    isBlank(config.text) ? 'Choose the text to rewrite' : `For ${platformWords(config.platform)}`,
});

export const generateVideo = defineNode({
  ...AI_BASICS,
  type: 'ai.generateVideo',
  title: 'Generate Video',
  description: 'Makes a short video from your prompt.',
  keywords: ['ai', 'video', 'reel', 'clip'],
  icon: 'video',
  status: 'comingSoon',
  comingSoonReason: 'Video generation is coming soon.',
  // Not in the sprint's P0 to P2 lists; parked with the P2 work.
  priority: 'P2',
  configSchema: z.object({ prompt: templateField(4_000) }).strict(),
  defaultConfig: { prompt: '' },
  outputShape: [{ path: 'video', label: 'Video', type: 'media' }],
  summary: () => 'Coming soon',
});

const renderDesignConfig = z
  .object({
    presetId: z.string().max(64),
    slots: z.array(z.object({ slot: z.string().max(64), value: templateField() }).strict()).max(40),
  })
  .strict();

export const renderDesign = defineNode({
  ...AI_BASICS,
  type: 'studio.renderDesign',
  title: 'Render Design',
  description: 'Fills a Studio design with your text and exports the slides.',
  keywords: ['studio', 'design', 'carousel', 'template', 'slides'],
  icon: 'design',
  status: 'comingSoon',
  comingSoonReason: 'Render Design is coming soon.',
  priority: 'P2',
  configSchema: renderDesignConfig,
  defaultConfig: { presetId: '', slots: [] },
  outputShape: [{ path: 'slides', label: 'Slides', type: 'list', of: 'media' }],
  summary: () => 'Coming soon',
});

export const AI_NODES = [
  generateText,
  generateImage,
  generateHashtags,
  rewriteInBrandVoice,
  generateVideo,
  renderDesign,
];
