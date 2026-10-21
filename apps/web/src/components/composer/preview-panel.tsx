'use client';

import { Avatar, AvatarFallback, AvatarImage, cn, Text } from '@postgear/ui';
import { Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PlatformIcon } from '@/components/platforms/platform-icon';
import { ChannelPreview } from '@/components/previews/channel-preview';
import { GenericPreview } from '@/components/previews/generic.preview';
import type { PreviewChannel } from '@/components/previews/preview-parts';
import type { ChannelReport, RenderedPart } from './channel-report';

/** Who the general preview says is posting: no account yet, so a stand-in. */
const DRAFT_CHANNEL: PreviewChannel = {
  id: 'draft',
  name: 'Your account',
  profile: 'preview',
  picture: null,
  color: 0,
};

/** Far past any platform's limit, so the general preview never flags an overrun. */
const DRAFT_MAX_LENGTH = 1_000_000;

/**
 * The live preview, one selected channel at a time.
 *
 * Every keystroke re-renders it from the same report the counters and the
 * queue check use, so what is shown is what the provider will receive. The
 * channel's platform issues sit directly under its preview, where the reason
 * a post cannot be queued is easiest to connect to what causes it.
 */
export function PreviewPanel({
  reports,
  draft = null,
  publishAt,
  focusChannelId,
  settings,
}: {
  reports: ChannelReport[];
  /**
   * The words and media to show in a general preview while no channel is
   * connected (2026-10-21), or null when channels exist. A platform's own
   * preview needs a platform; this one shows the post as plain text.
   */
  draft?: RenderedPart[] | null;
  publishAt: Date | null;
  /** The channel whose tab is open in the editor. Opening a tab previews that channel. */
  focusChannelId: string | null;
  /** Each channel's platform settings, keyed by channel id: a set title shows in the preview. */
  settings: Record<string, Record<string, unknown>>;
}) {
  const [chosen, setChosen] = useState<string | null>(focusChannelId);

  // Editing a channel's own version and looking at another channel's preview
  // is never what anyone wants, so the preview follows the tab. The switcher
  // still lets the preview be changed independently afterwards.
  useEffect(() => {
    if (focusChannelId) {
      setChosen(focusChannelId);
    }
  }, [focusChannelId]);
  const active = reports.find((report) => report.channel.id === chosen) ?? reports[0];

  return (
    <div className="flex flex-col gap-3">
      {!active &&
      draft &&
      draft.some((part) => part.text.trim() !== '' || part.media.length > 0) ? (
        <div className="flex flex-col gap-2">
          <div
            className="overflow-hidden rounded-lg border-2 border-outline"
            data-testid="preview-draft"
          >
            <GenericPreview
              channel={DRAFT_CHANNEL}
              parts={draft}
              // No platform, so no platform limit to measure against.
              maxLength={DRAFT_MAX_LENGTH}
              lengthMethod="utf16"
              publishAt={publishAt}
            />
          </div>
          <Text size="xs" muted>
            A general preview. Connect a channel to see it the way each platform shows it.
          </Text>
        </div>
      ) : !active ? (
        <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
          <Eye className="h-7 w-7 text-ink opacity-40" strokeWidth={2} />
          <p className="m-0 font-sans text-sm text-ink opacity-70">
            {draft
              ? 'Start writing to see your post here.'
              : 'Pick a channel and start writing to see the post the way that platform shows it.'}
          </p>
        </div>
      ) : (
        <>
          {reports.length > 1 ? (
            <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
              <legend className="sr-only">Preview channel</legend>
              {reports.map((report) => {
                const selected = report === active;
                const problems = report.issues.length + (report.channelProblem ? 1 : 0);

                return (
                  <button
                    key={report.channel.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setChosen(report.channel.id)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border-2 border-outline py-0.5 pe-2.5 ps-0.5 font-sans text-xs font-bold',
                      'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
                      selected
                        ? 'bg-actionPrimary text-onActionPrimary'
                        : 'bg-secondary text-ink hover:bg-actionPrimary/10',
                    )}
                  >
                    <Avatar size="sm" className="h-6 w-6">
                      {report.channel.picture ? (
                        <AvatarImage src={report.channel.picture} alt="" />
                      ) : null}
                      <AvatarFallback
                        colorSeed={report.channel.color ?? report.channel.id}
                        className="text-[10px]"
                      >
                        {report.channel.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="max-w-[9rem] truncate" title={report.channel.providerName}>
                      {report.channel.name}
                    </span>
                    <PlatformIcon
                      platform={report.channel.providerIdentifier}
                      title={report.channel.providerName}
                      className="h-5 w-5"
                    />
                    {problems > 0 ? (
                      <>
                        <span
                          aria-hidden="true"
                          className="flex h-4 min-w-4 items-center justify-center rounded-full bg-actionDanger px-1 text-[10px] text-onActionLight"
                        >
                          {problems}
                        </span>
                        <span className="sr-only">
                          , {problems} {problems === 1 ? 'issue' : 'issues'}
                        </span>
                      </>
                    ) : null}
                  </button>
                );
              })}
            </fieldset>
          ) : null}

          <section aria-label={`${active.channel.name} preview`}>
            {active.provider ? (
              <ChannelPreview
                providerIdentifier={active.channel.providerIdentifier}
                providerName={active.provider.name}
                rules={active.provider.rules}
                channel={{
                  id: active.channel.id,
                  name: active.channel.name,
                  profile: active.channel.profile,
                  picture: active.channel.picture,
                  color: active.channel.color,
                }}
                parts={active.parts}
                publishAt={publishAt}
                settings={settings[active.channel.id]}
              />
            ) : null}
          </section>

          {active.channelProblem || active.issues.length > 0 ? (
            <div className="rounded-md border-2 border-outline bg-secondary p-3">
              <Text size="sm" weight="bold">
                Before this can be queued for {active.channel.name}
              </Text>
              <ul className="m-0 mt-1 flex list-disc flex-col gap-1 ps-5">
                {active.channelProblem ? (
                  <li className="font-sans text-sm text-dangerInk">{active.channelProblem}</li>
                ) : null}
                {active.issues.map((issue) => (
                  <li
                    key={`${issue.part}-${issue.code}`}
                    className="font-sans text-sm text-dangerInk"
                  >
                    {active.parts.length > 1 ? `Part ${issue.part + 1}: ` : ''}
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Text size="sm" muted>
              Ready for {active.channel.name}.
            </Text>
          )}
        </>
      )}
    </div>
  );
}
