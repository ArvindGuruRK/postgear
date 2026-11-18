/**
 * The rights record (Sprint 12, Module 04; research 07, mitigation 1).
 *
 * Every import stores who confirmed the video is theirs, when, and which
 * wording they ticked. The wording is versioned: change the sentence, raise
 * the version, and every row still says which sentence its person saw. The
 * web's tick box shows this sentence (user stories CL-1.3, word for word).
 */

/** The tick box's sentence. Sentence case, as every label beside a control. */
export const CLIP_RIGHTS_TEXT = 'This video is mine, or I have permission to use it.';

/** Raise when `CLIP_RIGHTS_TEXT` changes. Stored on `ClipVideo.rightsTextVersion`. */
export const CLIP_RIGHTS_TEXT_VERSION = 1;
