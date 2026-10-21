import { BellIcon } from '@animateicons/react/lucide/bell-icon';
import { CalendarDaysIcon } from '@animateicons/react/lucide/calendar-days-icon';
import { ChartColumnIcon } from '@animateicons/react/lucide/chart-column-icon';
import { CreditCardIcon } from '@animateicons/react/lucide/credit-card-icon';
import { HouseIcon } from '@animateicons/react/lucide/house-icon';
import { ImageIcon } from '@animateicons/react/lucide/image-icon';
import { KeyRoundIcon } from '@animateicons/react/lucide/key-round-icon';
import { ListOrderedIcon } from '@animateicons/react/lucide/list-ordered-icon';
import { NetworkIcon } from '@animateicons/react/lucide/network-icon';
import { PaletteIcon } from '@animateicons/react/lucide/palette-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { SearchIcon } from '@animateicons/react/lucide/search-icon';
import { SignatureIcon } from '@animateicons/react/lucide/signature-icon';
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import { SquarePenIcon } from '@animateicons/react/lucide/square-pen-icon';
import { UsersIcon } from '@animateicons/react/lucide/users-icon';
import { WebhookIcon } from '@animateicons/react/lucide/webhook-icon';
import { type AnimatedIcon, MotionIcon } from '@postgear/ui';
import type { SearchPageIcon } from './search-pages';

/**
 * Animated glyphs, as the design system's own palette draws its rows: each
 * row is a control, and a control's icon plays when it is hovered or reached
 * by keyboard.
 */
const ICONS: Record<SearchPageIcon, AnimatedIcon> = {
  home: HouseIcon,
  calendar: CalendarDaysIcon,
  sparkles: SparklesIcon,
  queue: ListOrderedIcon,
  analytics: ChartColumnIcon,
  media: ImageIcon,
  seo: SearchIcon,
  channels: NetworkIcon,
  team: UsersIcon,
  billing: CreditCardIcon,
  key: KeyRoundIcon,
  webhook: WebhookIcon,
  signature: SignatureIcon,
  bell: BellIcon,
  palette: PaletteIcon,
  create: SquarePenIcon,
  connect: PlusIcon,
};

export function PageIcon({ icon }: { icon: SearchPageIcon }) {
  return <MotionIcon icon={ICONS[icon]} className="h-4 w-4 shrink-0" />;
}
