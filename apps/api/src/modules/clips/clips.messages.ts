/**
 * Every sentence the Clips routes answer with (Sprint 12).
 *
 * The failure sentences a person reads on a card or a job (links, imports,
 * exports) live once in `@postgear/video-engine`'s `CLIP_ERROR_MESSAGES`, so
 * the API, the worker and the web all say the same thing for the same code.
 * This file adds what only the HTTP layer says: not found, already running,
 * not reachable. Sentence case, plain words, no tool output ever.
 */
import { CLIP_ERROR_MESSAGES } from '@postgear/video-engine';

export const CLIPS_MESSAGES = {
  ...CLIP_ERROR_MESSAGES,
  JOB_NOT_FOUND: 'We could not find that job.',
  JOB_FINISHED: 'This has already finished.',
  JOB_NOT_STARTED: 'We could not start this right now. It will start on its own in a minute.',
  CANCEL_UNREACHABLE: 'We could not reach the video tools to stop this. Try again in a minute.',
  STREAM_STOPPED: 'Live progress stopped. Reload to see the latest.',
  JOB_GONE: 'This job is no longer there.',
  TOOLS_NOT_RUNNING: 'The video tools are not running right now. Try again in a few minutes.',
  FILE_LINK_INVALID: 'This link has expired. Go back and open the file again.',
  FILE_NOT_FOUND: 'We could not find that file.',
  ALLOWANCE_UNAVAILABLE: 'We could not check your allowance. Please try again in a minute.',
  INVALID_ID: 'That address is not valid.',
  // Module 04: videos and uploads.
  VIDEO_NOT_FOUND: 'We could not find that video.',
  VIDEO_NOT_FAILED: 'Only a video that did not finish can be tried again.',
  VIDEO_NOT_IMPORTING: 'This video is not coming in any more, so there is nothing to cancel.',
  VIDEO_CANCELLED: 'Cancelled. The video was removed.',
  VIDEO_DELETED: 'Video deleted.',
  UPLOAD_NOT_FOUND: 'We could not find that upload. Upload the file again.',
  // Module 05: clips and exports.
  CLIP_NOT_FOUND: 'We could not find that clip.',
  CLIP_UNREADABLE: 'This clip could not be read. Make a new clip from the video.',
} as const;
