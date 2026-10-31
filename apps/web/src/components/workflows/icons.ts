/**
 * `IconKey` (from `@postgear/automation`) to what draws it: the platform
 * logos from `components/platforms` for the social platforms and the apps
 * workflows connect to (Slack, Microsoft Teams, Discord, Microsoft Excel and
 * Google Sheets), lucide for built-ins.
 *
 * WhatsApp and email have no artwork in `public/icon/` yet (the owner
 * chose every platform logo there), so they use a lucide glyph until real
 * artwork is added; then they become `{ platform }` entries like Slack's, read
 * by `PlatformIcon`.
 */
import type { IconKey } from '@postgear/automation';
import {
  AlarmClock,
  Bell,
  CalendarClock,
  CircleAlert,
  Clapperboard,
  FilePen,
  Filter,
  GitBranch,
  GitMerge,
  Globe,
  Hash,
  Image,
  ListOrdered,
  type LucideIcon,
  Mail,
  MessageCircle,
  MousePointerClick,
  Palette,
  PencilLine,
  Send,
  Sparkles,
  Split,
  SquareCheckBig,
  StickyNote,
  UserCheck,
  WandSparkles,
  Webhook,
  Workflow,
  Zap,
} from 'lucide-react';

export type IconSource = { platform: string } | { glyph: LucideIcon };

const GLYPHS: Record<Exclude<IconKey, PlatformKey>, LucideIcon> = {
  'post-published': Zap,
  'post-failed': CircleAlert,
  schedule: CalendarClock,
  manual: MousePointerClick,
  webhook: Webhook,
  draft: FilePen,
  queue: ListOrdered,
  publish: Send,
  post: StickyNote,
  sparkles: Sparkles,
  image: Image,
  hashtag: Hash,
  wand: WandSparkles,
  video: Clapperboard,
  design: Palette,
  'if-else': GitBranch,
  paths: Split,
  filter: Filter,
  delay: AlarmClock,
  review: UserCheck,
  'set-fields': PencilLine,
  merge: GitMerge,
  bell: Bell,
  email: Mail,
  whatsapp: MessageCircle,
  http: Globe,
  run: Workflow,
  workspace: SquareCheckBig,
};

type PlatformKey =
  | 'instagram'
  | 'facebook'
  | 'x'
  | 'linkedin'
  | 'youtube'
  | 'tiktok'
  | 'pinterest'
  | 'slack'
  | 'teams'
  | 'discord'
  | 'google-sheets'
  | 'excel';

const PLATFORM_KEYS = new Set<string>([
  'instagram',
  'facebook',
  'x',
  'linkedin',
  'youtube',
  'tiktok',
  'pinterest',
  'slack',
  'teams',
  'discord',
  'google-sheets',
  'excel',
]);

export function iconSource(key: string): IconSource {
  if (PLATFORM_KEYS.has(key)) return { platform: key };
  return { glyph: GLYPHS[key as keyof typeof GLYPHS] ?? Workflow };
}
