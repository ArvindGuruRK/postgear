'use client';

/**
 * Four starter templates (Buffer's "Templates" row). A card opens the
 * composer with the template's text already in the post, [placeholders] and
 * all, at `/composer?template=<id>`; the text itself is resolved on the
 * server from `lib/post-templates.ts`.
 *
 * Each card is one pressable link (the onboarding tiles' press), with a small
 * icon on a palette fill the way the reference marks each template.
 */
import { ClapperboardIcon } from '@animateicons/react/lucide/clapperboard-icon';
import { LightbulbIcon } from '@animateicons/react/lucide/lightbulb-icon';
import { ListOrderedIcon } from '@animateicons/react/lucide/list-ordered-icon';
import { MessageCircleQuestionMarkIcon } from '@animateicons/react/lucide/message-circle-question-mark-icon';
import { type AnimatedIcon, cn, MotionIcon, pressSm } from '@postgear/ui';
import Link from 'next/link';
import { POST_TEMPLATES, type PostTemplateId } from '@/lib/post-templates';
import { CARD_ROW_ITEM, CardRow, FOCUS, HomeSection } from './home-ui';

const LOOK: Record<PostTemplateId, { icon: AnimatedIcon; fill: string }> = {
  'behind-the-scenes': { icon: ClapperboardIcon, fill: 'bg-avatar1 text-onAvatar1' },
  'lesson-learned': { icon: LightbulbIcon, fill: 'bg-avatar4 text-onAvatar4' },
  'quick-tips': { icon: ListOrderedIcon, fill: 'bg-avatar2 text-onAvatar2' },
  'ask-your-audience': { icon: MessageCircleQuestionMarkIcon, fill: 'bg-avatar6 text-onAvatar6' },
};

export function TemplatesRow({ orgId }: { orgId: string }) {
  return (
    <HomeSection title="Templates" data-testid="home-templates">
      <CardRow columns={4}>
        {POST_TEMPLATES.map((template) => {
          const look = LOOK[template.id];

          return (
            <li key={template.id} className={CARD_ROW_ITEM}>
              <Link
                href={`/${orgId}/composer?template=${template.id}`}
                data-testid="home-template"
                data-template={template.id}
                className={cn(
                  'flex w-full flex-col gap-3 rounded-lg border-2 border-outline bg-secondary p-4 text-ink md:p-5',
                  pressSm,
                  FOCUS,
                )}
              >
                <span
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-md border-2 border-outline',
                    look.fill,
                  )}
                >
                  <MotionIcon icon={look.icon} className="h-4 w-4" />
                </span>
                <span className="flex flex-col gap-1">
                  <span className="type-ui text-base">{template.title}</span>
                  <span className="line-clamp-2 font-sans text-sm opacity-75">
                    {template.description}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </CardRow>
    </HomeSection>
  );
}
