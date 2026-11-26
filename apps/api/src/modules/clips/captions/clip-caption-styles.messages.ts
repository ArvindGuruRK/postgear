import { MAX_CUSTOM_CAPTION_STYLES } from '@postgear/video-engine';

export const CLIP_CAPTION_STYLES_MESSAGES = {
  NOT_FOUND: 'We could not find that caption style.',
  DELETED: 'Caption style deleted.',
  LIMIT: `This workspace has ${MAX_CUSTOM_CAPTION_STYLES} caption styles of its own, the most it can keep. Delete one to save another.`,
} as const;
