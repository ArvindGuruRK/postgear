'use client';

import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormErrorMessage,
  FormField,
  FormLabel,
  Input,
  Text,
  toast,
} from '@postgear/ui';
import { Check } from 'lucide-react';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Channel } from '@/types/channel';
import { ChannelMark } from './channel-mark';

/**
 * The avatar palette, in slot order: the `--color-avatar-*` tokens in
 * packages/ui colors.css, the same slots `Channel.color` stores. Full class
 * strings so Tailwind sees them; the API refuses anything past the last one.
 */
const SWATCHES = [
  { name: 'Violet', fill: 'bg-avatar1 text-onAvatar1' },
  { name: 'Teal', fill: 'bg-avatar2 text-onAvatar2' },
  { name: 'Green', fill: 'bg-avatar3 text-onAvatar3' },
  { name: 'Yellow', fill: 'bg-avatar4 text-onAvatar4' },
  { name: 'Orange', fill: 'bg-avatar5 text-onAvatar5' },
  { name: 'Rose', fill: 'bg-avatar6 text-onAvatar6' },
  { name: 'Cyan', fill: 'bg-avatar7 text-onAvatar7' },
] as const;

/** The API's `nameSchema` ceiling (auth/dto/common.schema.ts), after trimming. */
const NAME_MAX = 80;

interface ChannelPreferencesDialogProps {
  channel: Channel | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/**
 * A channel's preferences, after the reference's "Preferences" in its channel
 * menu (UI revamp, 2026-10-19; this replaced the colour-only dialog): the
 * name PostGear shows for the channel, and the colour its initials are drawn
 * in everywhere. One Save sends only what changed, in one `PATCH`.
 *
 * The name is PostGear's own label: the platform's account keeps its name,
 * and a reconnect never overwrites this one (`upsertFromAuth` leaves `name`
 * alone on update). The colour is a stored palette slot that the calendar,
 * the composer, previews and analytics all read; a new channel gets the
 * first colour nobody uses, and this is for changing it after.
 *
 * The swatches are native radio inputs, visually hidden inside their
 * swatch, so the browser supplies the group semantics and the arrow keys;
 * the channel's own mark above them previews the choice before it is saved.
 */
export function ChannelPreferencesDialog({
  channel,
  onOpenChange,
  onDone,
}: ChannelPreferencesDialogProps) {
  const formId = useId();
  const [name, setName] = useState('');
  const [color, setColor] = useState(0);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(channel?.name ?? '');
    setColor(channel?.color ?? 0);
    setNameError(null);
    setError(null);
  }, [channel]);

  async function save(event: FormEvent) {
    event.preventDefault();

    if (!channel) {
      return;
    }

    // The same rule the API applies (whitespace collapsed, 1 to 80
    // characters), checked here so the person reads it beside the field.
    const trimmed = name.replace(/\s+/g, ' ').trim();

    if (trimmed.length === 0) {
      setNameError('Give the channel a name.');
      return;
    }

    if (trimmed.length > NAME_MAX) {
      setNameError(`Keep the name to ${NAME_MAX} characters.`);
      return;
    }

    setNameError(null);

    const body = {
      ...(trimmed !== channel.name ? { name: trimmed } : {}),
      ...(color !== channel.color ? { color } : {}),
    };

    if (Object.keys(body).length === 0) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await api(`/channels/${channel.id}`, { method: 'PATCH', body });
      toast({ title: 'Preferences saved' });
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'We could not save those preferences.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={channel !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form id={formId} onSubmit={save} noValidate>
          <DialogHeader>
            <DialogTitle>Preferences</DialogTitle>
            <DialogDescription className="sr-only">
              The channel's name and colour in PostGear.
            </DialogDescription>
          </DialogHeader>

          {channel ? (
            <div className="flex flex-col gap-5 py-4">
              <FormField>
                <FormLabel htmlFor={`${formId}-name`}>Name</FormLabel>
                <Input
                  id={`${formId}-name`}
                  value={name}
                  maxLength={NAME_MAX}
                  autoComplete="off"
                  variant={nameError ? 'error' : undefined}
                  onChange={(event) => setName(event.target.value)}
                />
                {nameError ? <FormErrorMessage>{nameError}</FormErrorMessage> : null}
              </FormField>

              <fieldset className="flex flex-col gap-3">
                <legend className="font-sans text-sm font-bold text-ink">Colour</legend>
                <div className="mt-2 flex items-center gap-3">
                  {/* Initials even when the channel has a picture: the picture
                      would hide the very thing being chosen. */}
                  <ChannelMark
                    color={color}
                    id={channel.id}
                    name={name.trim() || channel.name}
                    picture={null}
                    platform={channel.providerIdentifier}
                    platformName={channel.providerName}
                  />
                  <Text size="sm" muted>
                    {SWATCHES[color]?.name}
                  </Text>
                </div>

                <div className="flex flex-wrap gap-2">
                  {SWATCHES.map((swatch, slot) => {
                    const selected = slot === color;
                    return (
                      <label
                        key={swatch.name}
                        title={swatch.name}
                        className={cn(
                          'flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border-2 border-outline',
                          'has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focusRing',
                          swatch.fill,
                          selected ? 'shadow-brutalSm' : 'opacity-90 hover:opacity-100',
                        )}
                      >
                        <input
                          type="radio"
                          name={`${formId}-color`}
                          value={slot}
                          checked={selected}
                          onChange={() => setColor(slot)}
                          className="sr-only"
                        />
                        <span className="sr-only">{swatch.name}</span>
                        {selected ? (
                          <Check aria-hidden className="h-5 w-5" strokeWidth={3} />
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
