'use client';

/**
 * Settings, Clips (Sprint 13, Module 17 item 26): the workspace's speech
 * privacy switch.
 *
 * To make captions, find clips or cut words, Clips turns speech into text.
 * On our own servers by default; a PostGear may also send long speech to a
 * hosted listener (`TRANSCRIBER=auto`, decision D13-03). This switch keeps
 * every listen in the workspace on our own servers. The line under it says
 * what the switch changes on this PostGear, read from the media service's
 * hosted lane, so nobody is told about a service that is not in use.
 *
 * Everyone reads it; an admin changes it (the API's `@Roles` is the real
 * check, a member sees it disabled). Desktop only, like every Clips screen.
 */
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Stack,
  Toggle,
  toast,
} from '@postgear/ui';
import { useId, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { ClipsHostedLane } from '@/types/clips';

export interface ClipPrivacy {
  speechStaysHere: boolean;
  hostedLane: ClipsHostedLane;
}

export const PRIVACY_READ_ONLY = 'Only workspace admins can change these settings.';
export const PRIVACY_SAVE_FAILED = "Couldn't save that change.";
export const SPEECH_HELP =
  'Captions, Find Clips and cutting words all turn speech into text. On, the sound is never sent to another company for that, even for long videos.';

/** What the switch changes on this PostGear, for the line under it. */
export function speechLaneNote(lane: ClipsHostedLane | null | undefined, on: boolean): string {
  if (!lane?.on || !lane.providerName) {
    return 'Right now all speech stays on our own servers anyway. This keeps it that way if that ever changes.';
  }
  const provider = lane.providerName;
  if (!lane.aboveMinutes) {
    return on
      ? `This PostGear sends all speech to ${provider}, so listening will not work in this workspace while this is on.`
      : `Every listen sends the sound to ${provider} to be turned into text.`;
  }
  return on
    ? `Listening to more than ${lane.aboveMinutes} minutes at once stays on our own servers too, so it takes longer.`
    : `When more than ${lane.aboveMinutes} minutes are listened to at once, the sound is sent to ${provider} to be turned into text.`;
}

export function savedSentence(on: boolean): string {
  return on
    ? 'Speech in this workspace now stays on our own servers.'
    : 'Long speech in this workspace may be sent to a hosted service again.';
}

function describe(cause: unknown): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : PRIVACY_SAVE_FAILED;
}

export interface ClipsPrivacySettingsProps {
  initial: ClipPrivacy | null;
  /** Presentation only: a member reads it disabled. The API's guard is the real check. */
  isAdmin: boolean;
}

export function ClipsPrivacySettings({ initial, isAdmin }: ClipsPrivacySettingsProps) {
  const id = useId();
  const [privacy, setPrivacy] = useState<ClipPrivacy | null>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ text: string; wanted: boolean } | null>(null);

  async function save(on: boolean) {
    const previous = privacy;
    if (!isAdmin || !previous || saving) return;
    setPrivacy({ ...previous, speechStaysHere: on });
    setSaving(true);
    try {
      const answer = await api<{ privacy: ClipPrivacy }>('/clips/privacy', {
        method: 'PUT',
        body: { speechStaysHere: on },
      });
      setPrivacy(answer.privacy);
      setError(null);
      toast({ title: 'Saved', description: savedSentence(on) });
    } catch (cause) {
      setPrivacy(previous);
      setError({ text: describe(cause), wanted: on });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap="lg">
      {isAdmin ? null : (
        <Alert variant="info" data-testid="clips-privacy-read-only">
          {PRIVACY_READ_ONLY}
        </Alert>
      )}
      {error ? (
        <Alert variant="danger" data-testid="clips-privacy-error">
          <div className="flex flex-1 flex-col gap-1">
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{error.text}</AlertDescription>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={saving}
            onClick={() => void save(error.wanted)}
          >
            Try Again
          </Button>
        </Alert>
      ) : null}
      {privacy ? null : (
        <Alert variant="danger" data-testid="clips-privacy-load-failed">
          {"Couldn't load the Clips settings. Refresh the page to try again."}
        </Alert>
      )}

      <Card data-testid="clips-privacy" aria-busy={saving || undefined}>
        <CardHeader>
          <CardTitle>Speech Privacy</CardTitle>
          <CardDescription>
            Where the sound of your videos goes to be turned into text.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-1">
              <Label htmlFor={id}>Keep speech on our own servers</Label>
              <p className="m-0 font-sans text-xs text-ink type-muted">{SPEECH_HELP}</p>
              {privacy ? (
                <p
                  className="m-0 font-sans text-xs text-ink type-muted"
                  role="status"
                  data-testid="clips-privacy-lane"
                >
                  {speechLaneNote(privacy.hostedLane, privacy.speechStaysHere)}
                </p>
              ) : null}
            </div>
            <Toggle
              id={id}
              checked={privacy?.speechStaysHere === true}
              disabled={!isAdmin || !privacy || saving}
              data-testid="clips-privacy-speech-stays-here"
              onCheckedChange={(on) => void save(on)}
            />
          </div>
        </CardContent>
      </Card>
    </Stack>
  );
}
