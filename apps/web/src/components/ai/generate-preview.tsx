'use client';

/**
 * What the output side shows before the first generation (2026-10-26): the
 * five stages a post goes through, in order, each with what it does.
 *
 * It replaced a dashed "your post will appear here" box, which said where
 * the post would land but not how it is made. This is the same frame the
 * tracker fills in once Generate is pressed, so nothing moves when it
 * starts, and a stage this setup cannot run (no research key, no image
 * model) says so up front rather than being skipped by surprise.
 */
import { cn } from '@postgear/ui';
import type { AiStatus, GenerateStage } from '@/types/ai';
import { GENERATE_STAGES } from '@/types/ai';
import { AiSticker, INSET, PanelHeader } from './ai-ui';
import { STAGE_LABELS } from './generate-state';

const STAGE_COPY: Record<GenerateStage, string> = {
  research: 'Searches the web for fresh facts, and keeps the sources.',
  classify: 'Names the kind of post, so the hook and tone fit it.',
  hook: 'Writes the opening line that stops the scroll.',
  content: "Writes the post, or each part of a thread, within the channel's limit.",
  image: 'Draws a hero image for the first part, when you ask for one.',
};

export function GeneratePreview({ status }: { status: AiStatus }) {
  const off: Partial<Record<GenerateStage, string>> = {
    ...(status.research ? {} : { research: 'Off in this setup' }),
    ...(status.images ? {} : { image: 'Off in this setup' }),
  };

  return (
    <section className="flex flex-col gap-5" aria-labelledby="ai-preview">
      <PanelHeader
        id="ai-preview"
        title="From Topic To Post"
        sub={
          <span className="font-sans text-sm text-ink type-muted">
            Press Generate and each stage lands here as it runs. The post opens in the composer as a
            draft, so nothing goes out until you schedule it.
          </span>
        }
      />

      <ol className="m-0 flex list-none flex-col p-0">
        {GENERATE_STAGES.map((stage, index) => {
          const last = index === GENERATE_STAGES.length - 1;
          return (
            <li key={stage} className="flex gap-4">
              <span className="flex flex-col items-center" aria-hidden="true">
                <AiSticker className="rounded-full">{index + 1}</AiSticker>
                {last ? null : <span className="w-0.5 flex-1 bg-outline" />}
              </span>
              <span
                className={cn(
                  INSET,
                  'mb-3 flex min-w-0 flex-1 flex-col gap-1 px-4 py-3',
                  off[stage] && 'border-dashed',
                )}
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="type-ui text-sm text-ink">{STAGE_LABELS[stage]}</span>
                  {off[stage] ? (
                    <span className="font-sans text-xs text-ink type-muted">{off[stage]}</span>
                  ) : null}
                </span>
                <span className="font-sans text-sm text-ink type-muted">{STAGE_COPY[stage]}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
