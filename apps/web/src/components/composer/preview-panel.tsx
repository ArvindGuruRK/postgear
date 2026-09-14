'use client';

import { Avatar, AvatarFallback, AvatarImage, cn, EmptyState, Heading, Text } from '@postgear/ui';
import { Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ChannelPreview } from '@/components/previews/channel-preview';
import type { ChannelReport } from './channel-report';

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
  publishAt,
  focusChannelId,
}: {
  reports: ChannelReport[];
  publishAt: Date | null;
  /** The channel whose tab is open in the editor. Opening a tab previews that channel. */
  focusChannelId: string | null;
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
    <section aria-labelledby="composer-preview-heading" className="flex flex-col gap-3">
      <Heading level="h4" as="h2" id="composer-preview-heading">
        Preview
      </Heading>

      {!active ? (
        <EmptyState
          icon={Eye}
          title="Nothing to preview yet"
          description="Pick a channel and the post appears here the way that platform will show it."
          className="rounded-lg border-2 border-dashed border-outline p-6"
        />
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
                      'outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
                      selected
                        ? 'bg-actionPrimary text-onActionPrimary'
                        : 'bg-secondary text-ink hover:bg-actionPrimary/10',
                    )}
                  >
                    <Avatar size="sm" className="h-6 w-6">
                      {report.channel.picture ? (
                        <AvatarImage src={report.channel.picture} alt="" />
                      ) : null}
                      <AvatarFallback className="text-[10px]">
                        {report.channel.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="max-w-[9rem] truncate" title={report.channel.providerName}>
                      {report.channel.name}
                    </span>
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
                  name: active.channel.name,
                  profile: active.channel.profile,
                  picture: active.channel.picture,
                }}
                parts={active.parts}
                publishAt={publishAt}
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
                  <li className="font-sans text-sm text-actionDanger">{active.channelProblem}</li>
                ) : null}
                {active.issues.map((issue) => (
                  <li
                    key={`${issue.part}-${issue.code}`}
                    className="font-sans text-sm text-actionDanger"
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
    </section>
  );
}
