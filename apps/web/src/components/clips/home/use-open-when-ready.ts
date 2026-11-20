'use client';

/**
 * Bring a video in, then carry on in it (2026-11-19, the owner: "once it has
 * been uploaded, it should enter into the editing platform").
 *
 * Every upload that finishes and every new link import is followed here
 * while the Clips page is open. Its video is asked for every few seconds;
 * once it is READY the page moves on by itself, where `openTarget` says:
 *
 * - **edit**: one clip over the whole video (Edit Whole Video's call; making
 *   a clip charges nothing) and the editor opens on it. If that call is
 *   refused, the video page opens instead, so the person is never stuck.
 * - **video**: the video page, where Find Clips and the moment picker are.
 *
 * A video that failed or was removed is dropped quietly (its card says why).
 * **Stay Here** on a waiting row stops the jump for that video. Leaving the
 * page stops every jump (the hook's timers die with it).
 */
import { toast } from '@postgear/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { createWholeClip, getVideo } from '@/lib/clips-api';
import type { ClipVideoView } from '@/types/clips';
import { clipEditHref } from '../video/video-clip-list';
import { openTarget } from './home-model';

/** How often a waiting video is asked for. */
export const OPEN_POLL_MS = 2_500;

export interface Opening {
  videoId: string;
  title: string;
  /** Where it goes, once known; `null` until the video says (an upload may not know its length yet). */
  target: 'edit' | 'video' | null;
}

export interface OpenWhenReady {
  openings: Opening[];
  follow: (video: Pick<ClipVideoView, 'id' | 'title'> & Partial<ClipVideoView>) => void;
  stay: (videoId: string) => void;
}

export interface OpenWhenReadyApi {
  getVideo: typeof getVideo;
  createWholeClip: typeof createWholeClip;
}

const DEFAULT_API: OpenWhenReadyApi = { getVideo, createWholeClip };

function videoPageHref(orgId: string, videoId: string): string {
  return `/${encodeURIComponent(orgId)}/clips/video/${encodeURIComponent(videoId)}`;
}

export function useOpenWhenReady(
  orgId: string,
  api: OpenWhenReadyApi = DEFAULT_API,
  pollMs: number = OPEN_POLL_MS,
): OpenWhenReady {
  const router = useRouter();
  const [openings, setOpenings] = useState<Opening[]>([]);
  // One jump per page: the first ready video wins, the others stay listed.
  const jumped = useRef(false);

  const drop = useCallback(
    (videoId: string) => setOpenings((current) => current.filter((one) => one.videoId !== videoId)),
    [],
  );

  const follow = useCallback<OpenWhenReady['follow']>((video) => {
    setOpenings((current) =>
      current.some((one) => one.videoId === video.id)
        ? current
        : [
            ...current,
            {
              videoId: video.id,
              title: video.title,
              target:
                video.platform && video.kind && video.durationMs !== undefined
                  ? openTarget({
                      platform: video.platform,
                      kind: video.kind,
                      durationMs: video.durationMs,
                    })
                  : null,
            },
          ],
    );
  }, []);

  const ids = openings.map((one) => one.videoId).join(',');

  useEffect(() => {
    if (ids === '') return;
    const abort = new AbortController();
    let busy = false;

    const open = async (video: ClipVideoView) => {
      jumped.current = true;
      if (openTarget(video) === 'edit') {
        try {
          const { clip } = await api.createWholeClip(video.id);
          router.push(clipEditHref(orgId, clip.id));
          return;
        } catch {
          // Refused (a plan limit, a race): the video page still lets them carry on.
        }
      }
      router.push(videoPageHref(orgId, video.id));
    };

    const check = async () => {
      if (busy || jumped.current) return;
      busy = true;
      try {
        for (const videoId of ids.split(',')) {
          let video: ClipVideoView;
          try {
            video = (await api.getVideo(videoId, { signal: abort.signal })).video;
          } catch (cause) {
            if (abort.signal.aborted) return;
            if (cause instanceof ApiError && cause.status === 404) drop(videoId);
            continue;
          }
          if (video.status === 'READY') {
            drop(videoId);
            await open(video);
            return;
          }
          if (video.status === 'FAILED' || video.status === 'REMOVED') {
            drop(videoId);
            toast({ title: `${video.title} could not be brought in.`, variant: 'warning' });
          } else {
            const target = video.durationMs === null ? null : openTarget(video);
            setOpenings((current) =>
              current.map((one) =>
                one.videoId === videoId && one.target !== target ? { ...one, target } : one,
              ),
            );
          }
        }
      } finally {
        busy = false;
      }
    };

    const timer = window.setInterval(() => void check(), pollMs);
    void check();
    return () => {
      abort.abort();
      window.clearInterval(timer);
    };
  }, [ids, api, orgId, pollMs, router, drop]);

  return { openings, follow, stay: drop };
}
