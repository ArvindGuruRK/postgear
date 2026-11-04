'use client';

/**
 * The richer icons for the template preview card (Workflows revamp,
 * 2026-10-31): Phosphor's duotone set, one colour for each kind of step, so a
 * flow reads at a glance: triggers orange, AI violet, logic and posts blue,
 * apps and data green. Everywhere else a step keeps the plain lucide glyph
 * (`../icons.ts`). Wherever the owner added artwork to `public/icon/` (the
 * social platforms, Slack, Microsoft Teams, Discord, Microsoft Excel, Google
 * Sheets), that logo is drawn instead, here as there.
 */
import type { IconKey } from '@postgear/automation';
import {
  ArrowsSplit,
  BellRinging,
  CalendarCheck,
  EnvelopeSimple,
  FilmSlate,
  FlowArrow,
  Funnel,
  GitFork,
  GitMerge,
  Globe,
  HandTap,
  Hash,
  type Icon,
  ImageSquare,
  Lightning,
  ListNumbers,
  MagicWand,
  Note,
  NotePencil,
  PaintBrushBroad,
  PaperPlaneTilt,
  PencilSimpleLine,
  PlugsConnected,
  Sparkle,
  SquaresFour,
  Timer,
  UserCheck,
  WarningOctagon,
  WebhooksLogo,
  WhatsappLogo,
  Play,
  ShareNetwork,
} from '@phosphor-icons/react';
import { cn } from '@postgear/ui';
import { AppIcon } from '../app-icon';
import { iconSource } from '../icons';

/**
 * An icon's colour, as a class for the icon and a value for what else wears it. The icon sits on
 * the card as it is: no square or wash behind it.
 */
interface Tone {
  text: string;
  colour: string;
}

const TRIGGER: Tone = { text: 'text-actionAccent', colour: 'var(--color-brutal-accent)' };
const AI: Tone = { text: 'text-actionAi', colour: 'var(--color-brutal-ai)' };
const LOGIC: Tone = { text: 'text-actionPrimary', colour: 'var(--color-forth)' };
const APP: Tone = { text: 'text-actionSuccess', colour: 'var(--color-brutal-success)' };

const GLYPHS: Partial<Record<IconKey, { icon: Icon; tone: Tone }>> = {
  'post-published': { icon: Lightning, tone: TRIGGER },
  'post-failed': { icon: WarningOctagon, tone: TRIGGER },
  schedule: { icon: CalendarCheck, tone: TRIGGER },
  manual: { icon: HandTap, tone: TRIGGER },
  webhook: { icon: WebhooksLogo, tone: TRIGGER },
  sparkles: { icon: Sparkle, tone: AI },
  image: { icon: ImageSquare, tone: AI },
  hashtag: { icon: Hash, tone: AI },
  wand: { icon: MagicWand, tone: AI },
  video: { icon: FilmSlate, tone: AI },
  design: { icon: PaintBrushBroad, tone: AI },
  draft: { icon: NotePencil, tone: LOGIC },
  queue: { icon: ListNumbers, tone: LOGIC },
  publish: { icon: PaperPlaneTilt, tone: LOGIC },
  post: { icon: Note, tone: LOGIC },
  'if-else': { icon: GitFork, tone: LOGIC },
  paths: { icon: ArrowsSplit, tone: LOGIC },
  filter: { icon: Funnel, tone: LOGIC },
  delay: { icon: Timer, tone: LOGIC },
  review: { icon: UserCheck, tone: LOGIC },
  'set-fields': { icon: PencilSimpleLine, tone: LOGIC },
  merge: { icon: GitMerge, tone: LOGIC },
  run: { icon: Play, tone: LOGIC },
  workspace: { icon: SquaresFour, tone: LOGIC },
  bell: { icon: BellRinging, tone: APP },
  email: { icon: EnvelopeSimple, tone: APP },
  whatsapp: { icon: WhatsappLogo, tone: APP },
  http: { icon: Globe, tone: APP },
};

/** An icon with no entry of its own, so an unknown step still draws. */
const FALLBACK = { icon: FlowArrow, tone: LOGIC };

/** The colour a step goes by: its icon's, or for a logo the logo's own (`--color-logo-*`). */
export function stepColour(icon: string): string {
  const source = iconSource(icon);
  if ('platform' in source) return `var(--color-logo-${source.platform})`;
  return (GLYPHS[icon as IconKey] ?? FALLBACK).tone.colour;
}

/** A step's icon by its `IconKey`. A platform's logo stays its logo. */
export function StepGlyph({ icon, className }: { icon: string; className?: string }) {
  if ('platform' in iconSource(icon)) return <AppIcon icon={icon} className={className} />;
  const glyph = GLYPHS[icon as IconKey] ?? FALLBACK;
  const Glyph = glyph.icon;
  return <Glyph aria-hidden="true" weight="duotone" className={cn(glyph.tone.text, className)} />;
}

/**
 * A step's icon at the start of its row. It is drawn on the row's own surface,
 * in a box as wide as the icon, so every row's icon and the line down to the
 * next one stay in the same column.
 */
export function StepMark({ icon, className }: { icon: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('flex h-6 w-6 shrink-0 items-center justify-center', className)}
    >
      <StepGlyph icon={icon} className="h-5 w-5" />
    </span>
  );
}

/**
 * What a template needs, by the name `needNames` gives it. An app with a logo
 * in `public/icon/` wears it; a channel, which is any of the social accounts,
 * gets a glyph.
 */
const NEED_LOGOS: Record<string, string> = {
  Slack: 'slack',
  'Microsoft Teams': 'teams',
  Discord: 'discord',
  'Google Sheets': 'google-sheets',
  Google: 'google-sheets',
};

export function NeedGlyph({ name, className }: { name: string; className?: string }) {
  const logo = NEED_LOGOS[name];
  if (logo) return <AppIcon icon={logo} className={className} />;
  const Glyph = name === 'Channel' ? ShareNetwork : PlugsConnected;
  return <Glyph aria-hidden="true" weight="duotone" className={cn(LOGIC.text, className)} />;
}
