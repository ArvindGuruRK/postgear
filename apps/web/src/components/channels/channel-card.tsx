'use client';

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Stack,
  Text,
} from '@postgear/ui';
import { Clock, MoreVertical, Plug, RefreshCw, Trash2 } from 'lucide-react';
import type { Channel } from '@/types/channel';
import { CHANNEL_HEALTH } from './channel-health';

interface ChannelCardProps {
  channel: Channel;
  canManage: boolean;
  onReconnect: (channel: Channel) => void;
  onFinishSetup: (channel: Channel) => void;
  onEditTimes: (channel: Channel) => void;
  onDisconnect: (channel: Channel) => void;
}

/**
 * One connected channel.
 *
 * Two details worth keeping:
 *
 * - **The platform badge sits on the avatar**, bottom-right. At a glance the
 *   avatar answers "whose account" and the badge answers "on what" — which is
 *   the pair of questions a channel list exists to answer.
 * - **The handle is shown under the name.** With three LinkedIn accounts
 *   connected, a name alone is ambiguous, and the API already returns
 *   `profile` for exactly this.
 */
export function ChannelCard({
  channel,
  canManage,
  onReconnect,
  onFinishSetup,
  onEditTimes,
  onDisconnect,
}: ChannelCardProps) {
  const health = CHANNEL_HEALTH[channel.health];
  const initials = channel.name.slice(0, 2).toUpperCase();

  return (
    <Card className={channel.disabled ? 'opacity-60' : undefined}>
      <CardContent className="flex items-start gap-4 p-5">
        <div className="relative shrink-0">
          <Avatar size="lg">
            {channel.picture ? <AvatarImage src={channel.picture} alt="" /> : null}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          {/* The platform, as a corner sticker on the account's own avatar. */}
          <span
            className="absolute -bottom-1 -end-1 rounded-full border-2 border-outline bg-surface px-1.5 py-0.5 font-display text-[10px] uppercase leading-none"
            aria-hidden="true"
          >
            {channel.providerName.slice(0, 2)}
          </span>
        </div>

        <Stack gap="xs" className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Text weight="bold" className="truncate">
              {channel.name}
            </Text>
            <Badge variant={health.variant}>{health.label}</Badge>
          </div>

          <Text size="sm" muted className="truncate">
            {channel.profile ? `@${channel.profile}` : channel.providerName}
          </Text>

          {health.explanation ? (
            <Text size="sm" muted>
              {health.explanation}
            </Text>
          ) : (
            <Text size="sm" muted>
              {channel.postingTimes.length} posting{' '}
              {channel.postingTimes.length === 1 ? 'time' : 'times'} a day
            </Text>
          )}

          {/* The fix is offered inline, not buried in the menu — a broken
              channel silently stops everything, so the recovery has to be the
              most visible thing on the card. */}
          {health.action && canManage ? (
            <div className="pt-1">
              <Button
                size="sm"
                variant={channel.health === 'needs_reconnect' ? 'primary' : 'secondary'}
                onClick={() =>
                  channel.health === 'needs_setup' ? onFinishSetup(channel) : onReconnect(channel)
                }
              >
                {health.action}
              </Button>
            </div>
          ) : null}
        </Stack>

        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Manage ${channel.name}`}
                className="shrink-0"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onEditTimes(channel)}>
                <Clock className="me-2 h-4 w-4" />
                Edit posting times
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onReconnect(channel)}>
                <RefreshCw className="me-2 h-4 w-4" />
                Reconnect
              </DropdownMenuItem>
              {channel.inBetweenSteps ? (
                <DropdownMenuItem onSelect={() => onFinishSetup(channel)}>
                  <Plug className="me-2 h-4 w-4" />
                  Finish setup
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onDisconnect(channel)}>
                <Trash2 className="me-2 h-4 w-4" />
                Disconnect
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </CardContent>
    </Card>
  );
}
