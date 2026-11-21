'use client';

/**
 * The Follow Badge (Module 12 section 8): its small form, its platform
 * picker, and how wide it is.
 *
 * The badge's width comes from its two lines measured in its own font
 * (Inter, which the export draws it with), so the pill fits the words; it
 * is measured again when the name or the platform changes. Where the
 * browser cannot measure (a font still loading, tests) the engine's
 * estimate stands in.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconSelect,
  Input,
} from '@postgear/ui';
import {
  BADGE,
  BADGE_NAME_MAX,
  BADGE_PLATFORM_LOOK,
  type BadgePlatform,
  badgeSmallLine,
  badgeWidth,
  estimateBadgeTextWidth,
} from '@postgear/video-engine';
import { useId, useState } from 'react';
import { clipFontFamily } from '../editor/clip-fonts';
import { BADGE_CHOICES, badgeNameOf, isBadgePlatform } from './elements-model';

export const BADGE_NAME_PLACEHOLDER = 'Enter your channel name';
export const BADGE_FORM_SENTENCE =
  'A dark label with the platform in words and your channel name. It uses no platform logo.';

/** A line's width in canvas pixels, in the badge's font. */
async function lineWidth(text: string, spec: { size: number; weight: number }): Promise<number> {
  const font = `${spec.weight} ${spec.size}px ${clipFontFamily(BADGE.font)}`;
  try {
    await window.document.fonts?.load(font, text);
    const context = window.document.createElement('canvas').getContext('2d');
    if (context) {
      context.font = font;
      const width = context.measureText(text).width;
      if (width > 0) return width;
    }
  } catch {
    // The estimate below.
  }
  return estimateBadgeTextWidth(text, spec.size, spec.weight);
}

/** The badge's width at scale 1 for a platform and a name, in canvas pixels. */
export async function measureBadgeWidth(platform: BadgePlatform, name: string): Promise<number> {
  const [small, big] = await Promise.all([
    lineWidth(badgeSmallLine(platform), BADGE.small),
    lineWidth(name, BADGE.name),
  ]);
  return badgeWidth(small, big);
}

const PLATFORM_OPTIONS = BADGE_CHOICES.map((choice) => ({
  value: choice.value,
  label: choice.label,
  icon: (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 rounded-full border border-outline"
      style={{ background: BADGE_PLATFORM_LOOK[choice.value].disc }}
    />
  ),
}));

/** The platform and the name, as a pair of fields (the form and the selected badge share them). */
export function BadgeFields({
  platform,
  name,
  onPlatform,
  onName,
  autoFocus,
}: {
  platform: BadgePlatform;
  name: string;
  onPlatform: (platform: BadgePlatform) => void;
  onName: (name: string) => void;
  autoFocus?: boolean;
}) {
  const platformId = useId();
  const nameId = useId();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={platformId} className="font-sans text-sm text-ink type-label">
          Platform
        </label>
        <IconSelect
          id={platformId}
          options={PLATFORM_OPTIONS}
          value={platform}
          onValueChange={(value) => {
            if (isBadgePlatform(value)) onPlatform(value);
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className="font-sans text-sm text-ink type-label">
          Channel Name
        </label>
        <Input
          id={nameId}
          value={name}
          maxLength={BADGE_NAME_MAX}
          placeholder={BADGE_NAME_PLACEHOLDER}
          autoComplete="off"
          autoFocus={autoFocus}
          onChange={(event) => onName(event.target.value)}
        />
      </div>
    </div>
  );
}

/** Add Follow Badge: the platform and the name, then it goes on the clip at the playhead. */
export function BadgeFormDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (platform: BadgePlatform, name: string) => void;
}) {
  const [platform, setPlatform] = useState<BadgePlatform>('twitch');
  const [name, setName] = useState('');
  const clean = badgeNameOf(name);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Follow Badge</DialogTitle>
          <DialogDescription className="sr-only">{BADGE_FORM_SENTENCE}</DialogDescription>
        </DialogHeader>
        <form
          className="mt-5 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!clean) return;
            onAdd(platform, clean);
            setName('');
          }}
        >
          <BadgeFields
            platform={platform}
            name={name}
            onPlatform={setPlatform}
            onName={setName}
            autoFocus
          />
          <DialogFooter className="mt-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!clean}>
              Add Badge
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
