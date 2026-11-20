'use client';

/**
 * Recent Clips on the Clips home (Module 07, section 5): the newest four
 * clips as cards, with See All. Drawn only when there is a clip to show,
 * like Recent Videos; a list that failed to load is simply left out (the
 * Clips tab shows the error with Try Again).
 */
import { useEffect, useId, useState } from 'react';
import { AnalyticsPanel, PanelHeader } from '@/components/analytics/analytics-ui';
import { listClips } from '@/lib/clips-api';
import type { ClipListItem } from '@/types/clips';
import { SeeAll } from '../home/see-all';
import { clipActions } from './clip-actions';
import { ClipCard } from './clip-card';
import { listChange } from './clips-tab';
import { useClipSender } from './use-clip-sender';

export const RECENT_CLIPS = 4;

export function RecentClips({
  orgId,
  onAllClips,
  load = listClips,
}: {
  orgId: string;
  onAllClips: () => void;
  load?: typeof listClips;
}) {
  const headingId = useId();
  const [clips, setClips] = useState<ClipListItem[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void tick;
    const abort = new AbortController();
    load({ page: 1, signal: abort.signal })
      .then((answer) => setClips(answer.clips.slice(0, RECENT_CLIPS)))
      .catch(() => undefined);
    return () => abort.abort();
  }, [load, tick]);

  const sender = useClipSender(orgId);
  if (clips.length === 0) return null;

  const actions = clipActions({
    onChanged: (clip) =>
      setClips((current) =>
        current
          .map((one) => (one.id === clip.id ? { ...one, ...listChange(clip) } : one))
          .filter((one) => one.state !== 'hidden'),
      ),
    onAdded: () => setTick((value) => value + 1),
    onRemoved: (clipId) => setClips((current) => current.filter((one) => one.id !== clipId)),
    onStale: () => setTick((value) => value + 1),
    send: sender.open,
  });

  return (
    <AnalyticsPanel aria-labelledby={headingId} className="flex flex-col gap-4 p-5">
      <PanelHeader
        id={headingId}
        title="Recent Clips"
        aside={<SeeAll label="See All Clips" onClick={onAllClips} />}
      />
      <ul className="m-0 grid list-none grid-cols-4 gap-4 p-0">
        {clips.map((clip) => (
          <ClipCard key={clip.id} clip={clip} orgId={orgId} actions={actions} />
        ))}
      </ul>
      {sender.dialog}
    </AnalyticsPanel>
  );
}
