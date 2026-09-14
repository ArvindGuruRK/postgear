/**
 * One validator, run in the browser and at publish time.
 *
 * The composer calls it on every change to show what is wrong while the user
 * can still fix it; the API calls it before a post may enter the queue; and
 * every provider's `checkValidity` calls it before publishing. Same rules,
 * same code, same messages — so a post the composer shows as valid is a post
 * the provider will attempt, and a message the user saw in the composer is the
 * message a failed publish would report.
 *
 * It validates **rendered** parts. Callers render the document first
 * (`render.ts`), because length is a property of what the platform receives.
 */
import { measureLength } from './length';
import type { ProviderRules } from './rules';

export type MediaKind = 'image' | 'video';

/** What the validator needs to know about one attachment. */
export interface ComposedMedia {
  type: MediaKind;
  /** e.g. `image/jpeg`. Type checks are skipped when unknown. */
  mimeType?: string;
  /** Size checks are skipped when unknown. */
  bytes?: number;
  /** Shape checks are skipped when either dimension is unknown. */
  width?: number;
  height?: number;
}

/** One part of a post — the whole post, or one entry of a thread. */
export interface ComposedPart {
  /** Rendered text: exactly what the platform will receive. */
  text: string;
  media: ComposedMedia[];
}

export type IssueCode =
  | 'empty'
  | 'too_long'
  | 'media_required'
  | 'images_not_supported'
  | 'videos_not_supported'
  | 'too_many_items'
  | 'too_many_images'
  | 'too_many_videos'
  | 'mixed_media'
  | 'gif_not_alone'
  | 'image_type'
  | 'file_too_large'
  | 'aspect_ratio'
  | 'thread_unsupported'
  | 'follow_up_media'
  | 'title_too_long'
  | 'title_characters';

export interface ValidationIssue {
  code: IssueCode;
  /** Zero-based part the issue concerns. */
  part: number;
  /** Written for the person composing: says what to change, names the platform. */
  message: string;
}

export interface ValidateOptions {
  /** Used in every message, e.g. "Instagram". */
  providerName: string;
  /** An explicit title. Otherwise the first line of the first part is the title. */
  title?: string;
}

const GIF_MIME = 'image/gif';

const MIME_LABELS: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
};

export function validatePost(
  rules: ProviderRules,
  parts: ComposedPart[],
  options: ValidateOptions,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const name = options.providerName;
  const multiPart = parts.length > 1;

  parts.forEach((part, index) => {
    const label = multiPart ? `part ${index + 1}` : 'this post';
    const add = (code: IssueCode, message: string) => issues.push({ code, part: index, message });

    if (index > 0 && rules.thread === 'none') {
      // Reported once, on the first part that would be lost. Validating the
      // length of parts that will never be posted would only be noise.
      if (index === 1) {
        add(
          'thread_unsupported',
          `${name} can't publish a multi-part post — only part 1 would be posted. Remove the other parts or customize this channel.`,
        );
      }
      return;
    }

    const trimmed = part.text.trim();

    if (trimmed.length === 0 && part.media.length === 0) {
      add('empty', multiPart ? `Part ${index + 1} is empty.` : 'This post is empty.');
      return;
    }

    if (index > 0 && !rules.followUpMedia && part.media.length > 0) {
      add(
        'follow_up_media',
        `${name} publishes part ${index + 1} as a comment, and comments can't include media.`,
      );
    } else {
      validateMedia(rules, part, index, name, add);
    }

    const length = measureLength(part.text, rules.lengthMethod);

    if (length > rules.maxLength) {
      add(
        'too_long',
        `${name} allows ${rules.maxLength.toLocaleString('en-US')} characters; ${label} has ${length.toLocaleString('en-US')}.`,
      );
    }
  });

  if (rules.title && parts.length > 0) {
    validateTitle(rules.title, parts[0], options, issues);
  }

  return issues;
}

/** The message a caller that can show only one should show. */
export function firstIssueMessage(issues: ValidationIssue[]): string | null {
  return issues[0]?.message ?? null;
}

function validateMedia(
  rules: ProviderRules,
  part: ComposedPart,
  index: number,
  name: string,
  add: (code: IssueCode, message: string) => void,
): void {
  const { media } = rules;
  const images = part.media.filter((item) => item.type === 'image');
  const videos = part.media.filter((item) => item.type === 'video');
  const gifs = images.filter((item) => item.mimeType === GIF_MIME);

  if (images.length > 0 && media.maxImages === 0) {
    add('images_not_supported', `${name} posts can't include images.`);
  }

  if (videos.length > 0 && media.maxVideos === 0) {
    add('videos_not_supported', `PostGear can't publish video to ${name} yet.`);
  }

  // Only the first part is the post itself; later parts are replies or
  // comments, which never need an attachment. Counted against what the
  // platform accepts, so an image alone does not satisfy YouTube.
  const usable =
    (media.maxImages > 0 ? images.length : 0) + (media.maxVideos > 0 ? videos.length : 0);

  if (index === 0 && media.required && usable === 0) {
    add('media_required', requiredMessage(rules, name));
  }

  if (part.media.length === 0) {
    return;
  }

  if (media.gifCountsAsVideo && gifs.length > 0 && part.media.length > 1) {
    add('gif_not_alone', `${name} posts can have a GIF only on its own, without other media.`);
  } else if (!media.allowMixed && images.length > 0 && videos.length > 0) {
    add(
      'mixed_media',
      media.maxVideos === 1
        ? `${name} posts can have images or one video, not both.`
        : `${name} posts can have images or videos, not both.`,
    );
  }

  const tooManyImages = media.maxImages > 0 && images.length > media.maxImages;
  const tooManyVideos = media.maxVideos > 0 && videos.length > media.maxVideos;

  if (tooManyImages) {
    add(
      'too_many_images',
      media.maxImages === 1
        ? `${name} posts can have only one image.`
        : `${name} posts can have at most ${media.maxImages} images.`,
    );
  }

  if (tooManyVideos) {
    add(
      'too_many_videos',
      media.maxVideos === 1
        ? `${name} posts can have at most one video.`
        : `${name} posts can have at most ${media.maxVideos} videos.`,
    );
  }

  // The total is only worth reporting when no per-type limit already said it.
  if (
    !tooManyImages &&
    !tooManyVideos &&
    media.maxItems > 0 &&
    part.media.length > media.maxItems
  ) {
    add('too_many_items', `${name} posts can have at most ${media.maxItems} attachments.`);
  }

  if (
    media.imageMimeTypes &&
    images.some((item) => item.mimeType && !media.imageMimeTypes?.includes(item.mimeType))
  ) {
    const accepted = media.imageMimeTypes.map((type) => MIME_LABELS[type] ?? type).join(' and ');
    add('image_type', `${name} only accepts ${accepted} images.`);
  }

  const oversized = oversizedKind(part, rules);

  if (oversized) {
    add(
      'file_too_large',
      `${oversized.label} on ${name} must be ${formatBytes(oversized.limit)} or smaller.`,
    );
  }

  const ratio = media.imageAspectRatio;

  if (
    ratio &&
    images.some((item) => {
      if (!item.width || !item.height) {
        return false;
      }
      const shape = item.width / item.height;
      return shape < ratio.min || shape > ratio.max;
    })
  ) {
    add(
      'aspect_ratio',
      `${name} images must be between ${formatRatio(ratio.min)} (tall) and ${formatRatio(ratio.max)} (wide).`,
    );
  }
}

function requiredMessage(rules: ProviderRules, name: string): string {
  const { maxImages, maxVideos } = rules.media;

  if (maxImages > 0 && maxVideos > 0) {
    return `${name} posts must include at least one image or video.`;
  }

  if (maxVideos > 0) {
    return maxVideos === 1
      ? `${name} posts must have exactly one video.`
      : `${name} posts must include at least one video.`;
  }

  return maxImages === 1
    ? `${name} posts must include one image.`
    : `${name} posts must include at least one image.`;
}

function oversizedKind(
  part: ComposedPart,
  rules: ProviderRules,
): { label: string; limit: number } | null {
  const { media } = rules;

  for (const item of part.media) {
    if (item.bytes === undefined) {
      continue;
    }

    if (item.type === 'video') {
      if (media.maxVideoBytes !== undefined && item.bytes > media.maxVideoBytes) {
        return { label: 'Videos', limit: media.maxVideoBytes };
      }
      continue;
    }

    const isGif = item.mimeType === GIF_MIME;
    const limit = isGif ? (media.maxGifBytes ?? media.maxImageBytes) : media.maxImageBytes;

    if (limit !== undefined && item.bytes > limit) {
      return { label: isGif ? 'GIFs' : 'Images', limit };
    }
  }

  return null;
}

function validateTitle(
  rules: NonNullable<ProviderRules['title']>,
  first: ComposedPart,
  options: ValidateOptions,
  issues: ValidationIssue[],
): void {
  const title = options.title?.trim() || (first.text.split('\n')[0] ?? '').trim();
  const name = options.providerName;

  if (title.length > rules.maxLength) {
    issues.push({
      code: 'title_too_long',
      part: 0,
      message: `${name} titles are limited to ${rules.maxLength} characters. The first line is used as the title.`,
    });
  }

  const forbidden = rules.forbiddenCharacters.filter((character) => title.includes(character));

  if (forbidden.length > 0) {
    issues.push({
      code: 'title_characters',
      part: 0,
      message: `${name} titles cannot contain ${rules.forbiddenCharacters.join(' or ')} characters.`,
    });
  }
}

/** Binary megabytes, as every platform's own documentation means them. */
export function formatBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);

  if (megabytes >= 1) {
    return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 0.8 → "4:5", 1.91 → "1.91:1". */
function formatRatio(value: number): string {
  for (let denominator = 1; denominator <= 10; denominator++) {
    const numerator = value * denominator;

    if (Math.abs(numerator - Math.round(numerator)) < 1e-9) {
      return `${Math.round(numerator)}:${denominator}`;
    }
  }

  return `${value}:1`;
}
