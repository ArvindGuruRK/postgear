'use client';

/**
 * Add A Channel (Module 06, section 6): the platform as `ChoiceTiles`, the
 * name, **Check**, then **Add Channel**.
 *
 * - The name is checked here first with the engine's own rules
 *   (`validateHandle`), so a typo or a pasted video link is answered at once
 *   and for free; the server checks it again either way.
 * - **Check** asks the platform (`checkChannel`) and shows the avatar and the
 *   display name, so nobody adds the wrong channel. Changing the platform or
 *   the name clears that answer, and **Add Channel** only saves the channel
 *   that was checked.
 * - A plan at its channel limit gets the API's sentence with **See Plans**.
 */
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  ChoiceTiles,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  toast,
} from '@postgear/ui';
import {
  CLIP_ERROR_MESSAGES,
  type ClipPlatformId,
  PLATFORM_NAMES,
  validateHandle,
} from '@postgear/video-engine';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { addChannel, checkChannel } from '@/lib/clips-api';
import type { ClipChannelPreview, ClipChannelView } from '@/types/clips';
import { orderedPlatforms } from '../home/home-model';
import { RefusalAlert } from '../home/refusal-alert';
import { ONLY_PUBLIC_LINE } from './channels-model';

const UNREACHABLE = 'We could not reach Clips. Check your connection and try again.';

interface Refusal {
  message: string;
  code: string | undefined;
}

function refusalOf(cause: unknown): Refusal {
  return cause instanceof ApiError && cause.status !== 0
    ? { message: cause.message, code: cause.code }
    : { message: UNREACHABLE, code: undefined };
}

export function AddChannelDialog({
  open,
  onOpenChange,
  orgId,
  platforms,
  initialPlatform,
  onAdded,
  api = { check: checkChannel, add: addChannel },
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  platforms: readonly ClipPlatformId[];
  /** The platform tab the dialog was opened from. */
  initialPlatform?: ClipPlatformId;
  onAdded: (channel: ClipChannelView) => void;
  api?: { check: typeof checkChannel; add: typeof addChannel };
}) {
  const shown = orderedPlatforms(platforms);
  const firstPlatform =
    initialPlatform && shown.includes(initialPlatform) ? initialPlatform : shown[0];
  const [platform, setPlatform] = useState<ClipPlatformId | undefined>(firstPlatform);
  const [name, setName] = useState('');
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<ClipChannelPreview | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const fieldId = useId();
  const controller = useRef<AbortController | null>(null);

  // Every opening starts clean, on the platform it was opened from.
  useEffect(() => {
    if (!open) return;
    setPlatform(firstPlatform);
    setName('');
    setPreview(null);
    setRefusal(null);
    setChecking(false);
    setAdding(false);
  }, [open, firstPlatform]);

  useEffect(() => () => controller.current?.abort(), []);

  const clearAnswer = () => {
    controller.current?.abort();
    setChecking(false);
    setPreview(null);
    setRefusal(null);
  };

  const check = async () => {
    if (!platform || checking || adding) return;
    const local = validateHandle(platform, name);
    if (!local.ok) {
      setPreview(null);
      setRefusal({ message: CLIP_ERROR_MESSAGES[local.code], code: local.code });
      return;
    }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setChecking(true);
    setRefusal(null);
    setPreview(null);
    try {
      const channel = await api.check(platform, name.trim(), { signal: abort.signal });
      if (abort.signal.aborted) return;
      setPreview(channel);
    } catch (cause) {
      if (abort.signal.aborted) return;
      setRefusal(refusalOf(cause));
    } finally {
      if (!abort.signal.aborted) setChecking(false);
    }
  };

  const add = async () => {
    if (!platform || !preview || adding) return;
    setAdding(true);
    setRefusal(null);
    try {
      const channel = await api.add(platform, name.trim());
      onAdded(channel);
      onOpenChange(false);
      toast({ title: `${channel.displayName} is in your channels.` });
    } catch (cause) {
      setRefusal(refusalOf(cause));
    } finally {
      setAdding(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (preview) void add();
    else void check();
  };

  if (!platform) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !adding && onOpenChange(next)}>
      <DialogContent className="max-w-xl">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Add A Channel</DialogTitle>
            <DialogDescription>{ONLY_PUBLIC_LINE}</DialogDescription>
          </DialogHeader>

          {shown.length > 1 ? (
            <ChoiceTiles
              label="Platform"
              value={platform}
              disabled={adding}
              onValueChange={(next) => {
                setPlatform(next);
                clearAnswer();
              }}
              options={shown.map((one) => ({ value: one, label: PLATFORM_NAMES[one] }))}
            />
          ) : null}

          <div className="flex flex-col gap-2">
            <label htmlFor={fieldId} className="font-sans text-sm text-ink type-label">
              Channel name
            </label>
            <div className="flex items-stretch gap-3">
              <Input
                id={fieldId}
                autoComplete="off"
                spellCheck={false}
                value={name}
                disabled={adding}
                placeholder="Enter your channel name"
                onChange={(event) => {
                  setName(event.target.value);
                  clearAnswer();
                }}
                className="min-w-0 flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                disabled={name.trim() === '' || checking || adding}
                onClick={() => void check()}
              >
                {checking ? 'Checking' : 'Check'}
              </Button>
            </div>
          </div>

          {preview ? (
            <div
              className="flex items-center gap-3 rounded-md border-2 border-outline bg-inset p-3"
              aria-live="polite"
            >
              <Avatar size="md">
                {preview.avatarUrl ? (
                  <AvatarImage src={preview.avatarUrl} alt="" referrerPolicy="no-referrer" />
                ) : null}
                <AvatarFallback colorSeed={preview.handle}>
                  {preview.displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-sans text-base text-ink type-ui">
                  {preview.displayName}
                </span>
                <span className="truncate font-sans text-sm text-ink type-muted">
                  {PLATFORM_NAMES[preview.platform]}, {preview.handle}
                </span>
              </div>
            </div>
          ) : null}

          {refusal ? (
            <RefusalAlert message={refusal.message} code={refusal.code} orgId={orgId} />
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={adding}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!preview || adding}>
              {adding ? 'Adding' : 'Add Channel'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
