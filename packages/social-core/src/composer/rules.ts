/**
 * What a platform accepts, declared as data.
 *
 * ## Why declarative
 *
 * Sprint 3's providers expressed their limits as imperative `checkValidity`
 * code, which only the API could run. The composer needs the same rules live,
 * in the browser, on every keystroke, and the Sprint 4 plan names the failure
 * mode if it gets them any other way: platform rules hardcoded in the UI layer,
 * drifting away from the provider that actually publishes.
 *
 * So each provider declares a `ProviderRules` object, the API sends it to the
 * browser alongside the provider list, and one validator (`validate.ts`) runs
 * against it in both places. `checkValidity` in every provider is now that same
 * validator. There is one copy of each rule, and it lives next to the code that
 * posts.
 *
 * ## Rules describe what PostGear can publish, not what the platform allows
 *
 * Where the two differ, the rule is the narrower one. LinkedIn accepts video,
 * but PostGear's LinkedIn provider does not upload it yet, so LinkedIn's rules
 * say no video, and the composer says so before the user queues a post that
 * would lose its attachment at publish time.
 */
import type { LengthMethod } from './length';

/**
 * What happens to the second and later parts of a multi-part post.
 *
 * - `replies`: a native thread; each part replies to the one before (X).
 * - `comments`: the first part is the post; the rest are comments under it
 *   (LinkedIn, Facebook, Instagram).
 * - `none`: the platform has no such structure; only one part can be posted
 *   (YouTube, TikTok, Pinterest).
 */
export type ThreadMode = 'replies' | 'comments' | 'none';

export interface AspectRatioRange {
  /** Width ÷ height. 0.8 is 4:5 portrait. */
  min: number;
  /** Width ÷ height. 1.91 is 1.91:1 landscape. */
  max: number;
}

export interface MediaRules {
  /** At least one attachment is required. */
  required: boolean;
  /** Total attachments on one part. 0 means media is not accepted at all. */
  maxItems: number;
  /** 0 means images are not accepted. */
  maxImages: number;
  /** 0 means video is not accepted. */
  maxVideos: number;
  /** Whether images and video may share one part. */
  allowMixed: boolean;
  /**
   * X treats an animated GIF like a video: one, on its own. The media library
   * stores GIFs as images, so the rule has to say so explicitly.
   */
  gifCountsAsVideo?: boolean;
  /** Accepted image types. Absent means every type PostGear stores is accepted. */
  imageMimeTypes?: string[];
  /** Largest accepted image, in bytes. */
  maxImageBytes?: number;
  /** Largest accepted animated GIF, in bytes, where it differs from other images. */
  maxGifBytes?: number;
  /** Largest accepted video, in bytes. */
  maxVideoBytes?: number;
  /** Accepted image shapes. Checked only when the dimensions are known. */
  imageAspectRatio?: AspectRatioRange;
  /**
   * Sprint 12 (Clips, Module 17): what a video may be, checked by `videoFit`
   * only when the video's facts are known (exported clips have them; older
   * uploads get them from Module 19's backfill). Absent means no limit here.
   */
  /** The shortest accepted video, in milliseconds. */
  videoMinMs?: number;
  /** The longest accepted video, in milliseconds. */
  videoMaxMs?: number;
  /** The accepted shapes, or `'any'`. Absent means any. */
  videoRatios?: 'any' | readonly VideoShape[];
  /** The widest accepted video, in pixels. */
  videoMaxWidth?: number;
}

/** A video's shape as Clips names them (`packages/video-engine`'s ratios). */
export type VideoShape = '9:16' | '16:9' | '1:1' | '4:5';

export interface TitleRules {
  maxLength: number;
  /** Characters the platform rejects outright rather than escaping. */
  forbiddenCharacters: string[];
}

/**
 * Sprint 13 Module 13: whether the platform has a field that labels a post
 * as made with AI, which PostGear fills from the post's Made With AI switch.
 * `'none'`: the composer says "{Platform} has no label for AI".
 */
export type AiLabel = 'field' | 'none';

export interface ProviderRules {
  /** Character limit for one part, measured with `lengthMethod`. */
  maxLength: number;
  lengthMethod: LengthMethod;
  thread: ThreadMode;
  /**
   * Whether parts after the first can carry media.
   *
   * False wherever they are published as comments: every `comment()` in
   * `social-core` posts text alone, so an image on part two would be silently
   * dropped.
   */
  followUpMedia: boolean;
  media: MediaRules;
  /**
   * A title taken from the first line of the first part, for platforms that
   * require one. Absent where the platform has no title or truncates silently.
   */
  title?: TitleRules;
  /** Sprint 13 Module 13: see `AiLabel`. */
  aiLabel: AiLabel;
}
