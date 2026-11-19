/**
 * The words of `/legal/copyright` (Sprint 12, Module 19 section 5, decision
 * D12-16), kept apart from the page so the title-case test reads them and a
 * test can check the address. Plain words, and no promise beyond what we do:
 * we check, we remove every copy and block the link, we tell the workspace.
 */
import { CLIP_VIDEO_RIGHTS_REMOVED_LINE } from '@postgear/scheduling';

export const COPYRIGHT_ADDRESS = 'copyright@rkay.in';

export const COPYRIGHT_TITLE = 'Copyright Requests';

export const COPYRIGHT_INTRO =
  'If someone brought your video into Clips without your permission, tell us and we will take it out.';

export const COPYRIGHT_SECTIONS = [
  {
    heading: 'What To Send',
    lines: [
      'The link to your video on YouTube, Twitch or Kick. For a file someone uploaded, describe the video instead.',
      'Something that shows the video is yours, such as a link from your own channel or account.',
      'An email address we can reach you at.',
    ],
  },
  {
    heading: 'Where To Send It',
    lines: [`Email ${COPYRIGHT_ADDRESS}.`],
  },
  {
    heading: 'What Happens Next',
    lines: [
      'We check your request.',
      'If it is right, we remove every copy of the video from Clips and block its link, so nobody can bring it in again.',
      `We tell the workspace that had it: "${CLIP_VIDEO_RIGHTS_REMOVED_LINE}"`,
    ],
  },
  {
    heading: 'Sounds And Stickers',
    lines: [
      'To report a sound or a sticker from the Clips library, send its name and where you saw it to the same address.',
      'We hide it while we check, and remove it if it should not be there.',
    ],
  },
] as const;
