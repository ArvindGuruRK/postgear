'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
} from '@postgear/ui';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Channel, PostingTime } from '@/types/channel';

interface PostingTimesDialogProps {
  channel: Channel | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = [0, 15, 30, 45];

function format(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Edits a channel's daily posting slots.
 *
 * ## The shape, and its known limit
 *
 * `Integration.postingTimes` is a flat list of minutes-since-midnight that
 * applies to every day, so "9am on weekdays, 11am at weekends" cannot be
 * expressed. That is a real limitation, inherited from the schema rather than
 * chosen here — a weekday grid would be a better editor but needs a column
 * change, which is not this sprint's to make. Worth revisiting when the
 * scheduler lands and the constraint starts costing something.
 *
 * Times are edited and stored in the same units, with no timezone arithmetic on
 * the way in or out. The reference implementation converts UTC to local and
 * back inside its editor and gets it subtly wrong around offset boundaries;
 * doing the conversion once, where a post is actually scheduled, is both
 * simpler and harder to get wrong.
 */
export function PostingTimesDialog({ channel, onOpenChange, onDone }: PostingTimesDialogProps) {
  const [times, setTimes] = useState<PostingTime[]>([]);
  const [hour, setHour] = useState('9');
  const [minute, setMinute] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTimes(channel?.postingTimes ?? []);
    setError(null);
  }, [channel]);

  function addTime() {
    const value = Number(hour) * 60 + Number(minute);

    if (times.some((entry) => entry.time === value)) {
      return;
    }

    setTimes([...times, { time: value }].sort((a, b) => a.time - b.time));
  }

  async function save() {
    if (!channel) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await api(`/channels/${channel.id}`, {
        method: 'PATCH',
        body: { postingTimes: times },
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'We could not save those times.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={channel !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Posting times for {channel?.name}</DialogTitle>
          <DialogDescription>
            Slots the scheduler will offer when you queue a post to this channel.
          </DialogDescription>
        </DialogHeader>

        <Stack gap="lg">
          <div className="flex items-end gap-2">
            <Stack gap="xs" className="flex-1">
              <Text size="sm" weight="bold">
                Hour
              </Text>
              <Select value={hour} onValueChange={setHour}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {String(value).padStart(2, '0')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Stack>

            <Stack gap="xs" className="flex-1">
              <Text size="sm" weight="bold">
                Minute
              </Text>
              <Select value={minute} onValueChange={setMinute}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MINUTES.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {String(value).padStart(2, '0')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Stack>

            <Button type="button" onClick={addTime}>
              Add
            </Button>
          </div>

          <Stack gap="sm">
            <Text size="sm" weight="bold">
              Scheduled times ({times.length})
            </Text>

            {times.length === 0 ? (
              <Text size="sm" muted>
                No times yet. Add at least one before saving.
              </Text>
            ) : (
              <Stack gap="xs">
                {times.map((entry) => (
                  <div
                    key={entry.time}
                    className="flex items-center justify-between rounded-md border-2 border-outline px-3 py-2"
                  >
                    <Text className="tabular-nums">{format(entry.time)}</Text>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`Remove ${format(entry.time)}`}
                      onClick={() =>
                        setTimes(times.filter((candidate) => candidate.time !== entry.time))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </Stack>
            )}
          </Stack>

          {error ? (
            <Text size="sm" className="text-actionDanger">
              {error}
            </Text>
          ) : null}
        </Stack>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || times.length === 0}>
            {saving ? 'Saving…' : 'Save times'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
