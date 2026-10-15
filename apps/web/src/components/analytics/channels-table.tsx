'use client';

/**
 * Every channel side by side (user story 6.4): standing, followers,
 * impressions, engagements, rate, the shape of the range, posts.
 *
 * A dense data surface in the restrained profile (§15): `Table` has no
 * shadow and sets `font-sans` on everything inside it, numbers are
 * `tabular-nums` and right-aligned so columns line up, and the only colour
 * is the standing badge — which reuses the Sprint 5 vocabulary (success /
 * danger / secondary / outline) rather than inventing one. A badge whose
 * label does not say why ("Not supported", "Needs permissions") gets a
 * tooltip on a button, so the reason is reachable by keyboard.
 *
 * A row is also the channel filter: the name is a button (the accessible
 * path) and the row itself answers a click. Under the table, the same
 * channels as a `BarList` of engagement rate — the one number the table
 * cannot make comparable at a glance.
 */
import {
  Badge,
  BarList,
  type BarListItem,
  cn,
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
import { Info } from 'lucide-react';
import { useMemo } from 'react';
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
  const bars = useMemo<BarListItem[]>(
    () =>
      // The tone follows the channel's position in the table, so the bar
      // matches the sparkline and the trend line of the same channel.
      channels.flatMap((channel, index) =>
        channel.engagementRate === null
          ? []
          : [
              {
                id: channel.channelId,
                label: channel.name,
                value: channel.engagementRate,
                display: formatPercent(channel.engagementRate),
                hint: `${channel.providerName} · ${channel.posts} ${channel.posts === 1 ? 'post' : 'posts'}`,
                tone: toneForIndex(index),
                leading: <ChannelAvatar name={channel.name} picture={channel.picture} />,
              },
            ],
      ),
    [channels],
  );

  return (
    <div className="flex flex-col gap-6">
      <TooltipProvider delayDuration={200}>
        <Table aria-label="Channels">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Channel</TableHead>
              <TableHead>Metrics</TableHead>
              <TableHead className="text-right">Followers</TableHead>
              <TableHead className="text-right">Impressions</TableHead>
              <TableHead className="text-right">Engagements</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead>Impressions, by day</TableHead>
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
                      <ChannelAvatar name={channel.name} picture={channel.picture} />
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="truncate font-bold">{channel.name}</span>
                        <Badge variant="outline" className="w-fit px-2 py-0 text-[10px]">
                          {channel.providerName}
                        </Badge>
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
                              <Info className="h-3 w-3" strokeWidth={3} />
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
                              channel.followers.delta > 0
                                ? 'text-actionSuccess'
                                : 'text-actionDanger',
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

      <section aria-label="Engagement rate by channel" className="flex flex-col gap-3">
        <h3 className="m-0 type-label text-sm text-ink opacity-70">
          Engagement rate by channel
        </h3>
        <BarList items={bars} emptyMessage="No channel has impressions in this range yet." />
      </section>
    </div>
  );
}
