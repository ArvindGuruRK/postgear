'use client';

/**
 * Opens a published post on its platform (2026-11-14). The calendar card's
 * strip and the composer of a published post both offer it.
 *
 * One post can go out on several channels, each with its own permalink:
 * - **One link** is a plain link that opens the post in a new tab.
 * - **Several** open a short menu, one entry per channel, each with its
 *   platform's logo, so the person picks which one to look at.
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  TooltipHint,
} from '@postgear/ui';
import type { ReactElement, ReactNode } from 'react';
import { PlatformIcon, platformLabel } from '../platforms/platform-icon';
import type { PublishedLink } from './published-links';

/** The control's name: the platform when there is one link, else general. */
export function viewPublishedLabel(links: readonly PublishedLink[]): string {
  return links.length === 1
    ? `View On ${platformLabel(links[0].providerIdentifier)}`
    : 'View Published Post';
}

/**
 * The control, drawn by the caller: `className` styles the link or the
 * menu's button, `children` is what sits inside it. `iconOnly` gives an icon
 * with no visible text its name and a tooltip. Renders nothing when no
 * channel has gone out.
 */
export function ViewPublishedPost({
  links,
  className,
  children,
  iconOnly = false,
  align = 'end',
}: {
  links: readonly PublishedLink[];
  className: string;
  children: ReactNode;
  iconOnly?: boolean;
  align?: 'start' | 'end';
}) {
  if (links.length === 0) {
    return null;
  }

  const label = viewPublishedLabel(links);
  const withTooltip = (control: ReactElement) =>
    iconOnly ? (
      <TooltipHint label={label} side="top">
        {control}
      </TooltipHint>
    ) : (
      control
    );

  if (links.length === 1) {
    return withTooltip(
      <a
        href={links[0].url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={iconOnly ? label : undefined}
        data-testid="view-published-post"
        className={className}
      >
        {children}
      </a>,
    );
  }

  return (
    <DropdownMenu>
      {withTooltip(
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={iconOnly ? label : undefined}
            data-testid="view-published-post"
            className={className}
          >
            {children}
          </button>
        </DropdownMenuTrigger>,
      )}
      <DropdownMenuContent align={align}>
        {links.map((link) => (
          <DropdownMenuItem key={link.channelId} asChild>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View on ${platformLabel(link.providerIdentifier)}: ${link.name}`}
            >
              <PlatformIcon platform={link.providerIdentifier} />
              <span className="truncate">{link.name}</span>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
