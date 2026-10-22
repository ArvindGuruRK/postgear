'use client';

/**
 * The flame in the top bar: how many days in a row the workspace has
 * published, with the Lottie flame from `public/lottie/fire.json` (the
 * reference shows the same counter in the same spot, as a static icon).
 *
 * The numbers come from `GET /dashboard`, through the same hook Home uses, so
 * they follow the viewer's time zone and refresh when a post changes and every
 * minute. Nothing renders until they arrive: a wrong "0" while loading would
 * read as a lost streak.
 *
 * The flame is lit (in colour and moving) only once today has a published
 * post. A streak that is still alive but has no post today yet, and a streak
 * of zero, show it dimmed and still; the tooltip says what to do. Motion also
 * stays off for people who ask the system for reduced motion.
 *
 * The player is `lottie-web`'s light build (SVG, no expressions: the flame
 * uses none), imported on demand so it is its own chunk and never runs on the
 * server. The animation file is one request shared by every mount. While they
 * load the icon slot stays empty, and if either fails the static flame icon
 * takes its place, so the count is never lost over a decoration.
 */
import { cn, TooltipHint } from '@postgear/ui';
import type { AnimationItem } from 'lottie-web';
import { Flame } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useDashboard } from '../home/use-home-data';
import { dayStreakHint, dayStreakLabel, isFlameLit } from './day-streak-model';
import { useWorkspace } from './workspace-provider';

const FLAME_URL = '/lottie/fire.json';

/** One request for every mount of the badge; a failed load is retried on the next. */
let flame: Promise<object> | null = null;

function loadFlame(): Promise<object> {
  if (!flame) {
    flame = fetch(FLAME_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Flame animation: ${response.status}`);
        }
        return response.json() as Promise<object>;
      })
      .catch((error: unknown) => {
        flame = null;
        throw error;
      });
  }
  return flame;
}

/** True when the system asks for less motion; false on the server and until mounted. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return reduced;
}

function FlameIcon({ lit }: { lit: boolean }) {
  const box = useRef<HTMLSpanElement>(null);
  const player = useRef<AnimationItem | null>(null);
  const [failed, setFailed] = useState(false);
  const reduced = usePrefersReducedMotion();
  const playing = lit && !reduced;
  // Read when the player is created, which can be after `playing` last changed.
  const playingNow = useRef(playing);
  playingNow.current = playing;

  useEffect(() => {
    let active = true;

    Promise.all([import('lottie-web/build/player/lottie_light'), loadFlame()]).then(
      ([{ default: lottie }, data]) => {
        if (!active || !box.current) return;
        player.current = lottie.loadAnimation({
          container: box.current,
          renderer: 'svg',
          loop: true,
          autoplay: playingNow.current,
          // lottie-web edits the data it is given, so each player gets its own copy.
          animationData: structuredClone(data),
        });
      },
      () => active && setFailed(true),
    );

    return () => {
      active = false;
      player.current?.destroy();
      player.current = null;
    };
  }, []);

  // A post landing (or the motion preference flipping) after the player exists.
  useEffect(() => {
    if (playing) {
      player.current?.play();
    } else {
      player.current?.goToAndStop(0, true);
    }
  }, [playing]);

  if (failed) {
    return (
      <Flame
        aria-hidden
        className={cn('h-5 w-5', lit ? 'text-orange-500' : 'text-ink opacity-50')}
        strokeWidth={2.25}
      />
    );
  }

  return (
    <span ref={box} aria-hidden className={cn('block h-6 w-6', !lit && 'opacity-60 grayscale')} />
  );
}

export function DayStreak() {
  const { activeOrgId } = useWorkspace();
  const { summary } = useDashboard(null);
  const streak = summary?.dayStreak;

  if (!streak) {
    return null;
  }

  const lit = isFlameLit(streak);

  return (
    <TooltipHint label={dayStreakHint(streak)} side="bottom">
      <Link
        href={`/${activeOrgId}/home`}
        aria-label={dayStreakLabel(streak)}
        data-testid="day-streak"
        data-days={streak.days}
        data-lit={lit}
        className={cn(
          'flex h-9 shrink-0 items-center gap-1 rounded-md px-1 outline-none',
          'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        )}
      >
        <FlameIcon lit={lit} />
        <span className="type-ui text-sm text-ink tabular-nums">{streak.days}</span>
      </Link>
    </TooltipHint>
  );
}
