'use client';

/**
 * Made With AI (Sprint 13 Module 13): a footer control, shown only for a post
 * with a video. Its popover holds the switch, the help line, and one line for
 * each chosen platform that has no label for AI. The flag is sent to every
 * channel of the post; the platforms with a field for it (YouTube, Instagram)
 * receive it. It is suggested, never forced: a clip with a made-up voice
 * arrives with it on (the clip's Send dialog says why), and nothing else
 * turns it on.
 */
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import type { AiLabel } from '@postgear/social-core/composer';
import {
  Button,
  MotionIcon,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Text,
  Toggle,
} from '@postgear/ui';
import { useId } from 'react';
import type { DraftPart } from './composer-state';

export const AI_LABEL_HELP = 'Captions and cuts do not need this. A made-up voice or picture does.';

/** True when any part of the post (shared or one channel's own) carries a video. */
export function postHasVideo(shared: DraftPart[], custom: Record<string, DraftPart[]>): boolean {
  return [...shared, ...Object.values(custom).flat()].some((part) =>
    part.media.some((item) => item.type === 'video'),
  );
}

/** "{Platform} has no label for AI. ..." once per platform without a field, in order. */
export function noLabelNotes(
  platforms: { name: string; aiLabel: AiLabel | undefined }[],
): string[] {
  const names: string[] = [];
  for (const platform of platforms) {
    if (platform.aiLabel === 'field' || names.includes(platform.name)) continue;
    names.push(platform.name);
  }
  return names.map((name) => `${name} has no label for AI. Say it in your caption if you need to.`);
}

export function AiLabelControl({
  value,
  onChange,
  platforms,
  disabled = false,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  platforms: { name: string; aiLabel: AiLabel | undefined }[];
  disabled?: boolean;
}) {
  const switchId = useId();
  const notes = noLabelNotes(platforms);

  return (
    // Modal, like every menu in the composer's dialog: see `DateTimePicker`.
    <Popover modal>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          disabled={disabled}
          aria-label={value ? 'Made With AI: On' : 'Made With AI'}
          className="h-11 px-3 text-sm"
        >
          <MotionIcon icon={SparklesIcon} className="h-4 w-4 shrink-0" />
          <span>{value ? 'Made With AI: On' : 'Made With AI'}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="flex w-80 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={switchId} className="type-ui text-sm text-ink">
            Made With AI
          </label>
          <Toggle id={switchId} checked={value} onCheckedChange={onChange} />
        </div>
        <Text size="sm" muted>
          {AI_LABEL_HELP}
        </Text>
        {notes.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-1 rounded-md bg-inset p-2">
            {notes.map((note) => (
              <li key={note} className="font-sans text-sm text-ink">
                {note}
              </li>
            ))}
          </ul>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
