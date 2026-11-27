/**
 * The dashboard rail's entries (moved out of `dashboard-shell.tsx` in Sprint
 * 13 Module 14, so the role rule is tested without drawing the shell).
 */
import { CalendarDaysIcon } from '@animateicons/react/lucide/calendar-days-icon';
import { ChartColumnIcon } from '@animateicons/react/lucide/chart-column-icon';
import { ClapperboardIcon } from '@animateicons/react/lucide/clapperboard-icon';
import { CompassIcon } from '@animateicons/react/lucide/compass-icon';
import { HouseIcon } from '@animateicons/react/lucide/house-icon';
import { ImageIcon } from '@animateicons/react/lucide/image-icon';
import { ListOrderedIcon } from '@animateicons/react/lucide/list-ordered-icon';
import { PaletteIcon } from '@animateicons/react/lucide/palette-icon';
import { SearchIcon } from '@animateicons/react/lucide/search-icon';
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import { WorkflowIcon } from '@animateicons/react/lucide/workflow-icon';
import {
  canUseDiscover,
  canUseSeo,
  canUseWorkflows,
  canViewAnalytics,
  type RoleInput,
} from '@postgear/entitlements';
import type { AnimatedIcon } from '@postgear/ui';

/**
 * The rail's sections: Home first (2026-10-19, the Buffer-style dashboard
 * and the page sign-in lands on), then the reference's order: the calendar,
 * the AI (its "Agent"), then the read-and-manage pages. `label` is what fits
 * under a 20px icon in a 64px tile; the top bar shows the page's full name.
 *
 * Studio (Sprint 9) sits right after Media: it makes the images Media keeps.
 * Clips (Sprint 12) follows Studio: long videos into short clips, the other
 * maker of things to post.
 * Workflows (Sprint 10) follows Clips: it puts the other pages to work.
 * Discover (Sprint 11) follows Workflows: what to post about, where the
 * audience is. On a phone the first four stay in the tab bar and the rest,
 * Discover among them, open from More (`TabBar` in sidebar.tsx).
 *
 * Composer and Channels are not here, as in the reference: both are reached
 * from the calendar's channel card (Create Post, Add Channel, the channels
 * page button and each channel's menu) and from Home, and their routes stay
 * as they were.
 *
 * `allow` (Sprint 13, Module 14) hides an entry from a role the capability
 * answers no to: an Editor has no Analytics, Workflows, Discover or SEO. The
 * pages' own layouts refuse a typed address (`RoleGate`); the API refuses
 * the requests.
 */
export interface RailEntry {
  segment: string;
  label: string;
  icon: AnimatedIcon;
  desktopOnly?: boolean;
  allow?: (role: RoleInput) => boolean;
}

export const RAIL: readonly RailEntry[] = [
  { segment: 'home', label: 'Home', icon: HouseIcon },
  { segment: 'calendar', label: 'Calendar', icon: CalendarDaysIcon },
  { segment: 'ai-copilot', label: 'Copilot', icon: SparklesIcon },
  { segment: 'queue', label: 'Queue', icon: ListOrderedIcon },
  { segment: 'analytics', label: 'Analytics', icon: ChartColumnIcon, allow: canViewAnalytics },
  { segment: 'media', label: 'Media', icon: ImageIcon },
  { segment: 'studio', label: 'Studio', icon: PaletteIcon },
  { segment: 'clips', label: 'Clips', icon: ClapperboardIcon, desktopOnly: true },
  { segment: 'workflows', label: 'Workflows', icon: WorkflowIcon, allow: canUseWorkflows },
  { segment: 'discover', label: 'Discover', icon: CompassIcon, allow: canUseDiscover },
  { segment: 'seo-analyzer', label: 'SEO', icon: SearchIcon, allow: canUseSeo },
];

/** The rail entries this role may open, in order. */
export function railFor(role: RoleInput): readonly RailEntry[] {
  return RAIL.filter((item) => !item.allow || item.allow(role));
}
