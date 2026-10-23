'use client';

/**
 * The workspace's channels as one filter picker, shared by Queue and
 * Analytics (2026-10-23): "All Channels" first, then each channel with its
 * platform's logo, which stays in the field once a channel is chosen.
 *
 * The design system's `IconSelect` does the drawing; this only knows about
 * channels. `null` means all channels, so callers never see the sentinel.
 */
import { IconSelect } from '@postgear/ui';
import { Layers } from 'lucide-react';
import { PlatformIcon } from '@/components/platforms/platform-icon';
import type { Channel } from '@/types/channel';

const ALL_CHANNELS = '__all__';

export function ChannelSelect({
  channels,
  value,
  onValueChange,
  label = (channel) => channel.name,
  id,
  disabled,
  className,
}: {
  channels: Channel[];
  /** The chosen channel's id, or null for all channels. */
  value: string | null;
  onValueChange: (channelId: string | null) => void;
  /** A channel's name in the list, when a page adds to it ("Acme (no metrics)"). */
  label?: (channel: Channel) => string;
  id?: string;
  disabled?: boolean;
  /** For the field: width, height and surface. */
  className?: string;
}) {
  return (
    <IconSelect
      id={id}
      aria-label="Channel"
      disabled={disabled}
      className={className}
      value={value ?? ALL_CHANNELS}
      onValueChange={(next) => onValueChange(next === ALL_CHANNELS ? null : next)}
      options={[
        {
          value: ALL_CHANNELS,
          label: 'All Channels',
          // currentColor, so it turns white with the text on the highlighted option.
          icon: <Layers className="h-4 w-4" strokeWidth={2.5} />,
        },
        ...channels.map((channel) => ({
          value: channel.id,
          label: label(channel),
          icon: <PlatformIcon platform={channel.providerIdentifier} />,
        })),
      ]}
    />
  );
}
