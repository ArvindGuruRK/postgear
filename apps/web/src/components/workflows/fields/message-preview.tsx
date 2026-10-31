'use client';

/**
 * The live message preview under a Notify step's Configure fields (Module
 * 12, `form.preview`): the message as it would arrive, filled with the
 * panel's data. A recognisable layout per app in PostGear's own look, never
 * the app's exact styling, and never the connection's link.
 *
 * - Slack: an avatar, bold "PostGear", the text, the button, the footer line.
 * - Microsoft Teams: a card with a bold title, the text, the button.
 * - Discord: the bot's name, the text, and a 2,000 character counter that
 *   turns red near the limit.
 * - Email: who it goes to, the subject and the plain body.
 *
 * All of it is React text: nothing the data holds is ever read as markup.
 */
import type { MessagePreviewKind } from '@postgear/automation';
import { cn, Text } from '@postgear/ui';
import { useMemo } from 'react';
import { AppIcon } from '../app-icon';
import { useFieldEnv } from './field-env';
import { buildPreview, discordCount, type MessagePreview } from './preview-model';

const APP: Record<MessagePreviewKind, { icon: string; words: string }> = {
  slack: { icon: 'slack', words: 'How it looks in Slack' },
  teams: { icon: 'teams', words: 'How it looks in Microsoft Teams' },
  discord: { icon: 'discord', words: 'How it looks in Discord' },
  email: { icon: 'email', words: 'How the email looks' },
};

const EMPTY = 'Write a message to see it here.';

function Body({ text }: { text: string }) {
  return text ? (
    <p className="m-0 whitespace-pre-wrap break-words font-sans text-sm text-ink">{text}</p>
  ) : (
    <Text size="sm" muted>
      {EMPTY}
    </Text>
  );
}

/** A button drawn, not pressable: the preview never opens the link. */
function FakeButton({ link }: { link: string }) {
  return (
    <span
      className="inline-flex w-fit items-center rounded-md border-2 border-outline bg-secondary px-3 py-1 type-ui text-sm text-ink"
      title={link}
    >
      Open In PostGear
    </span>
  );
}

function Avatar({ letter }: { letter: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-actionPrimary type-heading text-sm text-onActionPrimary"
    >
      {letter}
    </span>
  );
}

function SlackLike({ preview }: { preview: MessagePreview }) {
  return (
    <div className="flex gap-3">
      <Avatar letter="P" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-baseline gap-2">
          <span className="font-sans text-sm font-bold text-ink">PostGear</span>
          <Text size="xs" muted as="span">
            App
          </Text>
        </span>
        <Body text={preview.text} />
        {preview.link ? <FakeButton link={preview.link} /> : null}
        {preview.footer ? (
          <Text size="xs" muted>
            {preview.footer}
          </Text>
        ) : null}
      </div>
    </div>
  );
}

function TeamsLike({ preview }: { preview: MessagePreview }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border-2 border-outline bg-inset p-3">
      {preview.title ? (
        <p className="m-0 break-words font-sans text-sm font-bold text-ink">{preview.title}</p>
      ) : null}
      <Body text={preview.text} />
      {preview.link ? <FakeButton link={preview.link} /> : null}
    </div>
  );
}

function DiscordLike({ preview }: { preview: MessagePreview }) {
  const count = discordCount(preview.text);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-3">
        <Avatar letter="P" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline gap-2">
            <span className="font-sans text-sm font-bold text-ink">PostGear</span>
            <span className="rounded-sm border-2 border-outline px-1 font-sans text-[10px] leading-4 font-bold text-ink">
              Bot
            </span>
          </span>
          <Body text={preview.text} />
        </div>
      </div>
      <span
        className={cn(
          'self-end font-sans text-xs tabular-nums',
          count.warn ? 'font-bold text-dangerInk' : 'muted-tone',
        )}
        data-testid="discord-count"
      >
        {count.words}
      </span>
      {count.over ? (
        <Text size="xs" className="text-dangerInk">
          Discord takes 2,000 characters. Longer messages are cut to fit.
        </Text>
      ) : null}
    </div>
  );
}

function EmailLike({ preview }: { preview: MessagePreview }) {
  return (
    <div className="flex flex-col gap-2">
      <Text size="xs" muted className="break-words">
        To: {preview.to.length ? preview.to.join(', ') : 'no one yet'}
      </Text>
      <p className="m-0 break-words font-sans text-sm font-bold text-ink">
        {preview.title || 'No subject yet'}
      </p>
      <Body text={preview.text} />
    </div>
  );
}

export function MessagePreviewBox({
  kind,
  config,
}: {
  kind: MessagePreviewKind;
  config: Record<string, unknown>;
}) {
  const env = useFieldEnv();
  const scope = env?.context.scope ?? {};
  const workflowName = env?.context.workflowName;
  const timeZone = env?.context.timeZone;
  const preview = useMemo(
    () => buildPreview(kind, config, scope, { workflowName, timeZone }),
    [kind, config, scope, workflowName, timeZone],
  );
  const sources = Object.values(env?.context.scopeSource ?? {});
  const filledWith = sources.some((source) => source.kind === 'lastTest')
    ? 'Filled with data from your last test.'
    : sources.some((source) => source.kind === 'pinned')
      ? 'Filled with pinned data and samples.'
      : 'Filled with sample data.';

  return (
    <section
      aria-label="Message preview"
      className="flex flex-col gap-2"
      data-testid="message-preview"
    >
      <span className="flex items-center gap-2 font-sans text-sm font-bold text-ink">
        <AppIcon icon={APP[kind].icon} />
        {APP[kind].words}
      </span>
      <div className="rounded-md border-2 border-outline bg-inset p-3">
        {kind === 'slack' ? <SlackLike preview={preview} /> : null}
        {kind === 'teams' ? <TeamsLike preview={preview} /> : null}
        {kind === 'discord' ? <DiscordLike preview={preview} /> : null}
        {kind === 'email' ? <EmailLike preview={preview} /> : null}
      </div>
      <Text size="xs" muted>
        {filledWith}
      </Text>
    </section>
  );
}
