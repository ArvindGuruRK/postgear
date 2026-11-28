'use client';

/**
 * What AI makes from a video, and where it goes (Sprint 13, Module 15).
 *
 * The app has no privacy page, so these few sentences sit in one quiet place:
 * an "i" beside the AI minutes chip in Clip Setup's Summary, the screen where
 * a video's AI work is chosen and paid for (Find Clips listens to the speech
 * and, for Follow The Speaker and the camera, finds faces). A tooltip keeps
 * the card as calm as it was; the lines are there for anyone who asks.
 *
 * The provider sentence shows only while the media service sends long speech
 * to a hosted listener (`ai.hostedLane` in `GET /clips/status`), and names it.
 * Module 17 item 26: a workspace that keeps speech here (Settings, Clips) is
 * told so instead, and never sees the provider sentence.
 * Desktop only, like every Clips screen.
 */
import { InfoIcon } from '@animateicons/react/lucide/info-icon';
import { Button, MotionIcon, TooltipHint } from '@postgear/ui';
import type { ClipsHostedLane } from '@/types/clips';

/** What is made, what faces are, and when both go: always shown. */
export const AI_PRIVACY_LINES = [
  'AI makes two things from a video: the text of what is said, and where faces are in the picture.',
  'Faces are kept as positions only, never as who someone is.',
  'Both are deleted with the video.',
] as const;

/** The hosted lane's sentence, or null while all speech stays on our own servers. */
export function hostedLaneLine(lane: ClipsHostedLane | null | undefined): string | null {
  if (!lane?.on || !lane.providerName) return null;
  if (!lane.aboveMinutes) {
    return `To turn speech into text, the sound is sent to ${lane.providerName}.`;
  }
  return `When more than ${lane.aboveMinutes} minutes are listened to at once, the sound is sent to ${lane.providerName} to be turned into text.`;
}

/** Module 17 item 26: the line for a workspace that keeps every listen here. */
export const SPEECH_STAYS_HERE_LINE = 'This workspace keeps all speech on our own servers.';

/** Every line the hint shows, in order. */
export function aiPrivacyLines(
  lane: ClipsHostedLane | null | undefined,
  speechStaysHere = false,
): string[] {
  if (speechStaysHere) return [...AI_PRIVACY_LINES, SPEECH_STAYS_HERE_LINE];
  const hosted = hostedLaneLine(lane);
  return hosted ? [...AI_PRIVACY_LINES, hosted] : [...AI_PRIVACY_LINES];
}

export function AiPrivacyHint({
  lane,
  speechStaysHere = false,
}: {
  lane?: ClipsHostedLane | null;
  speechStaysHere?: boolean;
}) {
  const lines = aiPrivacyLines(lane, speechStaysHere);
  return (
    <TooltipHint
      side="bottom"
      label={
        <span className="flex max-w-72 flex-col gap-1" data-testid="clip-setup-privacy-lines">
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      }
    >
      <Button
        variant="ghost"
        size="sm"
        className="w-8 shrink-0 px-0"
        aria-label="What AI Makes From A Video"
        data-testid="clip-setup-privacy"
      >
        <MotionIcon icon={InfoIcon} className="h-4 w-4" />
      </Button>
    </TooltipHint>
  );
}
