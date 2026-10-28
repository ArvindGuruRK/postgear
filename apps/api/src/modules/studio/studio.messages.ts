/**
 * Every sentence Studio shows a person.
 *
 * One file per module, as everywhere else, so the wording can be read and
 * changed without opening a service. Sentence case, one or two short
 * sentences, and each one says what to do next where there is something to
 * do: the stories' rule 10. Where the stories give the exact words (section
 * 5, "Edge Cases And Expected Behaviour"), these are those words.
 *
 * The warnings an export streams about a design's own content (a deleted
 * picture, text too long for its space) are not here: they come from the
 * design engine's `issueMessage`, so the editor, the slide rail and the
 * export dialog describe a problem in the same words.
 */
export const STUDIO_MESSAGES = {
  // Designs
  DESIGN_NOT_FOUND: 'That design could not be found.',
  DESIGN_DELETED: 'Design deleted.',
  /** A stale `revision`. The editor turns this into Reload. */
  DESIGN_CONFLICT: 'This design changed in another tab.',
  /** A stored document this version cannot parse: a 422, never a 500. */
  DESIGN_UNREADABLE: 'This design could not be opened because part of it was not recognised.',
  NOTHING_TO_SAVE: 'There is nothing to save.',
  TITLE_REQUIRED: 'Enter a name for this design.',
  TEMPLATE_NOT_FOUND: 'That template could not be found.',
  TEMPLATE_WRONG_FORMAT: 'That template is not available in this format.',

  // Brand kits
  BRAND_KIT_NOT_FOUND: 'That brand kit could not be found.',
  BRAND_KIT_DELETED: 'Brand kit deleted. Designs that used it keep their colours.',
  BRAND_KIT_NAME_REQUIRED: 'Enter a name for this brand kit.',
  WEBSITE_INVALID: 'Enter a website address like https://example.com.',
  LOGO_NOT_FOUND: 'That logo is no longer in your media library.',
  LOGO_NO_FILE: 'Choose a logo to upload.',
  /** The stories' exact sentence for a logo of the wrong type or size. */
  LOGO_REJECTED: 'Logos can be PNG, JPG, SVG or WebP, up to 5 MB.',
  LOGO_UNREADABLE: 'That logo could not be read. Save it as a PNG and upload that instead.',
  LOGO_UNSAFE_SVG:
    'That SVG contains scripts or links to other files. Save it as a PNG and upload that instead.',

  // Extraction
  EXTRACT_PRIVATE: 'That address is not public.',
  /** The stories' sentence for a site that blocks bots, times out or has nothing to read. */
  EXTRACT_FAILED: 'We could not read that site. You can enter the brand details yourself.',
  EXTRACT_RATE_LIMITED: 'That is a lot of websites at once. Try again in a minute.',

  // Export and send
  /** The stories' sentence for a server without its export browser. */
  EXPORT_UNAVAILABLE: 'Export is not available right now. Please try again later.',
  EXPORT_BUSY: 'This design is already being exported. Wait for it to finish.',
  EXPORT_FAILED: 'The export stopped unexpectedly. Please try again.',
  SEND_CAPTION_INVALID: 'The caption cannot be used in a post as it is. Shorten it in Preview.',
  CHANNEL_UNAVAILABLE:
    'One of the chosen channels is no longer connected. Choose your channels again.',

  // Download All
  DOWNLOAD_NOTHING: 'Export this design first, then download it.',
  DOWNLOAD_MISSING:
    'Some exported slides are no longer in your media library. Export again to download them all.',

  // Share links
  SHARE_NOT_FOUND: 'That share link could not be found.',
  /** Expired, revoked and never-existed all read the same, on purpose. */
  SHARE_UNAVAILABLE: 'This link is no longer available.',
  SHARE_REVOKED: 'Share link revoked.',

  // Fonts
  FONT_NOT_FOUND: 'That font could not be found.',

  /** Names the slide by the number the user sees, so "which one" is never a guess. */
  slideFailed(index: number, reason: string): string {
    return `Slide ${index + 1} could not be rendered. ${reason}`;
  },

  slideNotSaved(index: number): string {
    return `Slide ${index + 1} could not be saved to your media library. Please try again.`;
  },

  rendering(index: number, total: number): string {
    return `Rendering slide ${index + 1} of ${total}`;
  },

  shareLimit(max: number): string {
    return `This design already has ${max} working share links. Revoke one to make another.`;
  },
} as const;

/** Why one slide could not be drawn, in words a person can act on. */
export const SLIDE_FAILURE_REASONS = {
  timeout: 'It took too long to draw.',
  fonts: 'A font it uses could not be loaded.',
  picture: 'A picture on it could not be loaded. Try again in a moment.',
  browser: 'The export browser stopped responding.',
  unknown: 'Something went wrong while drawing it.',
} as const;

export type SlideFailureReason = keyof typeof SLIDE_FAILURE_REASONS;

/** The `code` of an export or send stream's `error` event. */
export type StudioStreamFailure =
  | 'no_browser'
  | 'render_failed'
  | 'save_failed'
  | 'send_failed'
  | 'unexpected';
