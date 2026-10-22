'use client';

/**
 * Every channel side by side (user story 6.4): standing, followers,
 * impressions, engagements, rate, the shape of the range, posts.
 *
 * A dense data surface in the restrained profile (§15): `Table` has no
 * shadow and sets `font-sans` on everything inside it, numbers are
 * `tabular-nums` and right-aligned so columns line up, and the only colour
 * is the standing badge, which reuses the Sprint 5 vocabulary (success /
 * danger / secondary / outline) rather than inventing one. A badge whose
 * label does not say why ("Not supported", "Needs permissions") gets a
 * tooltip on a button, so the reason is reachable by keyboard.
 *
 * A row is also the channel filter: the name is a button (the accessible
 * path) and the row itself answers a click. The table is the light layer
 * inside its chrome panel (revamp, 2026-10-22); the channels compared as
 * bars moved to the By Channel panel beside the chart, which follows the
 * chart's metric.
 */
import { InfoIcon } from '@animateicons/react/lucide/info-icon';
import {
  Badge,
  cn,
  MotionIcon,
  Sparkline,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@postgear/ui';
import { PlatformIcon } from '@/components/platforms/platform-icon';
import type { ChannelAnalytics } from '@/types/analytics';
import {
  formatDelta,
  formatMetric,
  formatPercent,
  sparklineFor,
  syncBadge,
  toneForIndex,
} from './analytics-view-model';
import { ChannelAvatar } from './channel-avatar';

const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

export function ChannelsTable({
  channels,
  selectedId,
  now,
  onSelect,
}: {
  channels: ChannelAnalytics[];
  selectedId: string | null;
  now: Date;
  onSelect: (channelId: string | null) => void;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Table aria-label="Channels" className="bg-secondary">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Channel</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Followers</TableHead>
            <TableHead className="text-right">Impressions</TableHead>
            <TableHead className="text-right">Engagements</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead>Impressions Trend</TableHead>
            <TableHead className="text-right">Posts</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {channels.map((channel, index) => {
            const badge = syncBadge(channel, now);
            const selected = selectedId === channel.channelId;
            const toggle = () => onSelect(selected ? null : channel.channelId);

            return (
              <TableRow
                key={channel.channelId}
                data-testid="analytics-channel-row"
                data-channel={channel.channelId}
                data-state={selected ? 'selected' : undefined}
                className="cursor-pointer"
                onClick={toggle}
              >
                <TableCell className="min-w-[14rem]">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle();
                    }}
                    aria-pressed={selected}
                    aria-label={`${selected ? 'Show all channels' : `Show only ${channel.name}`}`}
                    className={cn('flex items-center gap-3 rounded-md text-start', FOCUS)}
                  >
                    <ChannelAvatar
                      id={channel.channelId}
                      color={channel.color}
                      name={channel.name}
                      picture={channel.picture}
                    />
                    {/* The platform as its logo beside the name (2026-10-22),
                        not a labelled badge under it; the logo carries the
                        platform's name for screen readers. */}
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-bold">{channel.name}</span>
                      <PlatformIcon
                        platform={channel.providerIdentifier}
                        title={channel.providerName}
                      />
                    </span>
                  </button>
                </TableCell>
                <TableCell>
                  {badge.explanation ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={(event) => event.stopPropagation()}
                          className={cn('rounded-full', FOCUS)}
                          aria-label={`${badge.label}. ${badge.explanation}`}
                        >
                          <Badge variant={badge.variant} data-standing={badge.label}>
                            {badge.label}
                            <MotionIcon
                              icon={InfoIcon}
                              size={12}
                              strokeWidth={3}
                              className="h-3 w-3"
                            />
                          </Badge>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">{badge.explanation}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Badge variant={badge.variant} data-standing={badge.label}>
                      {badge.label}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {channel.followers ? (
                    <span className="flex flex-col items-end">
                      <span>{formatMetric(channel.followers.value)}</span>
                      {channel.followers.delta !== null && channel.followers.delta !== 0 ? (
                        <span
                          className={cn(
                            'text-xs font-semibold',
                            channel.followers.delta > 0 ? 'text-successInk' : 'text-dangerInk',
                          )}
                        >
                          {formatDelta(channel.followers.delta)}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="opacity-50">–</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMetric(channel.impressions.value)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMetric(channel.engagements.value)}
                </TableCell>
                <TableCell className="text-right font-bold tabular-nums">
                  {formatPercent(channel.engagementRate)}
                </TableCell>
                <TableCell>
                  <Sparkline points={sparklineFor(channel)} tone={toneForIndex(index)} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMetric(channel.posts)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TooltipProvider>
  );
}
