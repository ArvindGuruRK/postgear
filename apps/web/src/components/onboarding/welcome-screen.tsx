'use client';

import { ArrowRightIcon } from '@animateicons/react/lucide/arrow-right-icon';
import { Button, cn, MotionIcon } from '@postgear/ui';
import {
  AtSign,
  CalendarDays,
  ChartLine,
  Heart,
  Image as ImageIcon,
  type LucideIcon,
  Megaphone,
  MessageCircle,
  Send,
  Sparkles,
  ThumbsUp,
  TrendingUp,
} from 'lucide-react';
import type { Ref } from 'react';
import { PlatformIcon } from '@/components/platforms/platform-icon';
import { OnboardingHeader } from './onboarding-chrome';

/**
 * The first thing a new account sees. The layout is Buffer's welcome
 * (docs/screenshots 20): a greeting and one "Let's start" button in the
 * middle of the page, platform logos scattered around it, no back arrow and
 * no progress dots, since nothing has started yet.
 *
 * The look is PostGear's own neobrutalism rather than the reference's faded
 * glow (the user's call, 2026-10-19): the greeting sits on a bordered card
 * with a hard shadow, and the scattered tiles are solid stickers, each with
 * its own border, hard shadow and tilt, on graph-paper lines. The words stay
 * plain: a tilted marker block behind "PostGear" was tried and taken out
 * (2026-10-20).
 *
 * The backdrop is decoration only (`aria-hidden`, no pointer events). The
 * stickers drift a few pixels up and down, out of step with each other, and
 * hold still under reduced motion (`.pg-float` in globals.css). On a phone
 * the ones level with the card are left out so none of them sits behind it.
 */

interface Tile {
  left: number;
  top: number;
  /** A `rotate-*` class: every sticker leans its own way. */
  tilt: string;
  /** Left out below `md`, where it would sit behind the greeting. */
  wide?: boolean;
  platform?: string;
  icon?: LucideIcon;
  fill?: string;
}

/**
 * Every sticker, platform or not, is this one size, so the scatter stays even
 * however many platforms are added: a new one is a line in `TILES`, never a
 * new size. Smaller on a phone, where full-size stickers crowd the card.
 */
const STICKER_SIZE = 'h-11 w-11 md:h-14 md:w-14';

/**
 * A platform logo sits on the sticker's card with a small, even gap all
 * round (the user's call, 2026-10-20): the card stays visible as a frame,
 * just thin, and the logo takes the rest.
 */
const PLATFORM_GAP = 'p-1 md:p-1.5';

// Positions follow the reference's scatter, as percentages of the page.
const TILES: Tile[] = [
  { left: 18, top: 11, tilt: '-rotate-6', icon: ImageIcon, fill: 'bg-avatar4 text-onAvatar4' },
  { left: 32, top: 10, tilt: 'rotate-6', platform: 'x' },
  { left: 72, top: 10, tilt: '-rotate-3', icon: Send, fill: 'bg-avatar1 text-onAvatar1' },
  { left: 17, top: 23, tilt: 'rotate-3', platform: 'youtube' },
  {
    left: 74,
    top: 23,
    tilt: 'rotate-12',
    icon: MessageCircle,
    fill: 'bg-avatar5 text-onAvatar5',
    wide: true,
  },
  { left: 83, top: 22, tilt: '-rotate-6', platform: 'pinterest' },
  {
    left: 29,
    top: 34,
    tilt: '-rotate-12',
    icon: TrendingUp,
    fill: 'bg-avatar6 text-onAvatar6',
    wide: true,
  },
  { left: 20, top: 41, tilt: '-rotate-3', platform: 'linkedin', wide: true },
  {
    left: 74,
    top: 40,
    tilt: 'rotate-6',
    icon: AtSign,
    fill: 'bg-avatar3 text-onAvatar3',
    wide: true,
  },
  {
    left: 86,
    top: 41,
    tilt: '-rotate-6',
    icon: Heart,
    fill: 'bg-avatar2 text-onAvatar2',
    wide: true,
  },
  {
    left: 26,
    top: 47,
    tilt: 'rotate-6',
    icon: ThumbsUp,
    fill: 'bg-avatar7 text-onAvatar7',
    wide: true,
  },
  { left: 80, top: 52, tilt: 'rotate-3', platform: 'facebook', wide: true },
  { left: 14, top: 64, tilt: 'rotate-6', icon: ChartLine, fill: 'bg-avatar3 text-onAvatar3' },
  { left: 29, top: 64, tilt: '-rotate-6', platform: 'instagram' },
  { left: 44, top: 68, tilt: 'rotate-3', platform: 'tiktok' },
  {
    left: 54,
    top: 67,
    tilt: '-rotate-12',
    icon: Megaphone,
    fill: 'bg-avatar4 text-onAvatar4',
    wide: true,
  },
  {
    left: 63,
    top: 74,
    tilt: 'rotate-6',
    icon: CalendarDays,
    fill: 'bg-avatar2 text-onAvatar2',
    wide: true,
  },
  { left: 72, top: 64, tilt: '-rotate-3', platform: 'linkedin', wide: true },
  { left: 83, top: 70, tilt: 'rotate-12', icon: Sparkles, fill: 'bg-avatar6 text-onAvatar6' },
];

export function WelcomeScreen({
  firstName,
  titleRef,
  onStart,
}: {
  firstName: string | null;
  titleRef: Ref<HTMLHeadingElement>;
  onStart: () => void;
}) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <Backdrop />

      <OnboardingHeader />

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center pr-[max(1rem,env(safe-area-inset-right))] pb-[max(18vh,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
        <div className="flex w-full max-w-lg flex-col items-center gap-7 rounded-2xl border-2 border-outline bg-secondary px-6 py-9 text-center shadow-brutalLg md:px-10 md:py-11">
          <h1
            ref={titleRef}
            tabIndex={-1}
            className="flex flex-col items-center gap-3 type-heading text-2xl text-ink outline-none md:text-3xl"
          >
            <span>
              {firstName ? 'Hey there, ' : 'Hey there'}
              {/* The name and the hand never part across a line break. */}
              <span className="whitespace-nowrap">
                {firstName}
                {/* The Home greeting's hand: animated, its first frame under
                    reduced motion. A plain <img> so the animation survives.
                    Inline and sized in `em` so it sits on the line like a
                    letter: the hand fills the lower right of its square, so
                    centring the square (as a flex row did) left it hanging
                    below the words. */}
                <picture>
                  <source
                    srcSet="/logo/waving-hand-still.webp"
                    media="(prefers-reduced-motion: reduce)"
                  />
                  <img
                    src="/logo/waving-hand.webp"
                    alt=""
                    width={36}
                    height={36}
                    className="ml-[0.2em] inline-block h-[1.15em] w-[1.15em] align-[-0.1em]"
                    decoding="async"
                  />
                </picture>
              </span>
            </span>
            <span>Welcome to PostGear</span>
          </h1>

          <Button size="lg" onClick={onStart}>
            Let&apos;s start
            <MotionIcon icon={ArrowRightIcon} className="h-4 w-4" />
          </Button>
        </div>
      </main>
    </div>
  );
}

function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="pg-welcome-grid absolute inset-0" />

      {TILES.map((tile, index) => (
        <span
          key={`${tile.platform ?? 'icon'}-${tile.left}-${tile.top}`}
          className={cn(
            'pg-float absolute -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-xl border-2 border-outline shadow-brutalSm',
            STICKER_SIZE,
            tile.wide ? 'hidden md:flex' : 'flex',
            tile.platform ? cn('bg-secondary', PLATFORM_GAP) : tile.fill,
            tile.tilt,
          )}
          style={{
            left: `${tile.left}%`,
            top: `${tile.top}%`,
            // Out of step, so the page breathes rather than bobbing in unison.
            animationDelay: `${-((index * 9) % 70) / 10}s`,
          }}
        >
          {tile.platform ? (
            <PlatformIcon platform={tile.platform} className="h-full w-full" />
          ) : tile.icon ? (
            <tile.icon className="h-5 w-5 md:h-6 md:w-6" strokeWidth={2.5} />
          ) : null}
        </span>
      ))}
    </div>
  );
}
