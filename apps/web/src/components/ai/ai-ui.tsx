'use client';

/**
 * Pieces the AI Copilot page's sections share (revamp, 2026-10-26).
 *
 * The Generate brief is the one section in a panel (`AiPanel`, Analytics'
 * chrome card); the output and the copilot sit straight on the page ground
 * (the owner's calls, 2026-10-26). Each section has a Title Case name
 * (`PanelHeader`), and only what you read or pick is a bordered box on the
 * light card layer (`INSET`), so the borders mean something. Stickers are the filled, outlined icon tiles the rest of the
 * app uses; violet stays the AI's colour (design-system-rules.md section
 * 16b), so the copilot's own mark is violet and everything else keeps its
 * usual role colour.
 */
import { cn } from '@postgear/ui';
import { FileText, Image as ImageIcon, type LucideIcon, PenSquare, Radio } from 'lucide-react';
import type { CopilotToolName } from '@/types/ai';

export {
  AnalyticsPanel as AiPanel,
  FOCUS,
  PanelHeader,
  SEGMENTED_LIST,
  SEGMENTED_TRIGGER,
} from '../analytics/analytics-ui';

/** A box set into its panel (the inset layer), for what you read or pick. */
export const INSET = 'rounded-lg border-2 border-outline bg-inset';

/** What each copilot tool looks like, wherever it is named. */
export const TOOL_ICONS: Record<CopilotToolName, LucideIcon> = {
  list_channels: Radio,
  generate_post: PenSquare,
  draft_post: FileText,
  generate_image: ImageIcon,
};

type StickerTone = 'ai' | 'primary' | 'success' | 'danger' | 'accent' | 'plain';

const STICKER_FILL: Record<StickerTone, string> = {
  ai: 'bg-actionAi text-onActionAi',
  primary: 'bg-actionPrimary text-onActionPrimary',
  success: 'bg-actionSuccess text-onActionLight',
  danger: 'bg-actionDanger text-onActionLight',
  accent: 'bg-actionAccent text-onActionLight',
  plain: 'bg-secondary text-ink',
};

const STICKER_SIZE = {
  sm: { box: 'h-7 w-7 rounded-md', icon: 'h-3.5 w-3.5' },
  md: { box: 'h-9 w-9 rounded-md', icon: 'h-4 w-4' },
  lg: { box: 'h-14 w-14 rounded-lg shadow-brutalSm', icon: 'h-7 w-7' },
} as const;

/**
 * An icon as a sticker: a filled, outlined tile. Decorative, so the name
 * beside it has to say what it is. `bg-clip-padding` keeps the fill inside
 * the border at the rounded corners.
 */
export function AiSticker({
  icon: Icon,
  tone = 'plain',
  size = 'md',
  className,
  children,
}: {
  icon?: LucideIcon;
  tone?: StickerTone;
  size?: keyof typeof STICKER_SIZE;
  className?: string;
  /** In place of the icon: a step number, a spinner. */
  children?: React.ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center border-2 border-outline bg-clip-padding type-ui text-sm',
        STICKER_SIZE[size].box,
        STICKER_FILL[tone],
        className,
      )}
    >
      {Icon ? <Icon className={STICKER_SIZE[size].icon} strokeWidth={2.5} /> : children}
    </span>
  );
}
