/**
 * Creator Tools (Sprint 13, Module 14): two large tiles, Emote Maker and
 * Schedule Maker, each with one line under its name. No in-page title (the
 * top bar names the page). Both tools cost no AI minutes; their downloads
 * count toward the day's download limit.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { MotionIcon, PageActions } from '@postgear/ui';
import { CalendarDays, Smile } from 'lucide-react';
import Link from 'next/link';
import { ActionLink } from '@/components/home/home-actions';
import { emoteHref, scheduleMakerHref } from './emote-model';

const TILES = [
  {
    name: 'Emote Maker',
    line: 'Turn up to 3 seconds of your stream into chat emotes for Twitch, 7TV and BTTV.',
    icon: Smile,
    href: emoteHref,
    testId: 'creator-tools-emote',
  },
  {
    name: 'Schedule Maker',
    line: "Make a picture of your week's streams and finish it in Design Studio.",
    icon: CalendarDays,
    href: scheduleMakerHref,
    testId: 'creator-tools-schedule',
  },
] as const;

export function CreatorTools({ orgId }: { orgId: string }) {
  return (
    <div className="flex flex-col gap-4" data-testid="creator-tools">
      <PageActions className="justify-start">
        <ActionLink href={`/${encodeURIComponent(orgId)}/clips`} data-testid="creator-tools-back">
          <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
          Back To Clips
        </ActionLink>
      </PageActions>
      <div className="grid grid-cols-2 gap-6">
        {TILES.map((tile) => {
          const Icon = tile.icon;
          return (
            <Link
              key={tile.name}
              href={tile.href(orgId)}
              className="group flex flex-col gap-3 rounded-card border-2 border-outline bg-secondary p-6 shadow-brutalSm transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
              data-testid={tile.testId}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-md border-2 border-outline bg-inset">
                <Icon className="h-6 w-6 text-ink" strokeWidth={2.5} aria-hidden="true" />
              </span>
              <h2 className="m-0 font-sans text-xl text-ink type-heading">{tile.name}</h2>
              <p className="m-0 font-sans text-sm text-ink type-muted">{tile.line}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
