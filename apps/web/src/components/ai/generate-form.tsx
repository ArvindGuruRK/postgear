'use client';

/**
 * The generate brief: topic, voice, format and hero image, channels, and the
 * price of pressing the button (revamped 2026-10-26).
 *
 * A narrow column read top to bottom as four numbered steps, so a
 * first-timer sees the whole brief at a glance and knows where they are.
 * Voice and format are choice tiles rather than a radio list and a select:
 * every option, and what it means, is on screen without opening anything.
 * The tiles keep radio semantics (arrow keys move the choice).
 *
 * Controlled from the panel above it, which keeps the values so "Regenerate"
 * on the result can send exactly what was asked. The form validates what the
 * API will (topic 3 to 2000 characters, at least one channel) before
 * sending, so a refusal that could be seen coming is shown next to the field
 * rather than as a 400 after the fact; the API still has the final say.
 *
 * The cost on the button is the API's own price list, and the button is
 * disabled when the balance cannot cover it, with the reset date, since
 * "not enough credits" with no "until when" is a dead end.
 */
import { CircleStopIcon } from '@animateicons/react/lucide/circle-stop-icon';
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import {
  Alert,
  AlertTitle,
  Button,
  cn,
  FormErrorMessage,
  FormHelperText,
  Label,
  MotionIcon,
  RadioGroup,
  RadioGroupItem,
  Textarea,
  Toggle,
} from '@postgear/ui';
import {
  AlignLeft,
  Building2,
  Cpu,
  Globe,
  Image as ImageIcon,
  Layers,
  ListOrdered,
  type LucideIcon,
  MessageSquare,
  User,
} from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import type { AiCredits, AiStatus, GenerateRequestBody, PostFormat, Tone } from '@/types/ai';
import type { Channel } from '@/types/channel';
import { ChannelPicker } from '../composer/channel-picker';
import { useMounted } from '../posts/use-mounted';
import { AiSticker, INSET } from './ai-ui';
import { formatResetDate } from './credits-meter';
import { type CharacterLimit, FORMAT_OPTIONS, generateCost } from './generate-state';

export const TOPIC_MIN = 3;
export const TOPIC_MAX = 2000;

const FORMATS = new Set<string>(FORMAT_OPTIONS.map((option) => option.value));

const FORMAT_ICONS: Record<PostFormat, LucideIcon> = {
  one_short: MessageSquare,
  one_long: AlignLeft,
  thread_short: ListOrdered,
  thread_long: Layers,
};

export function GenerateForm({
  orgId,
  channels,
  status,
  credits,
  workspaceName,
  values,
  limit,
  running,
  onChange,
  onGenerate,
  onStop,
}: {
  orgId: string;
  channels: Channel[];
  status: AiStatus;
  credits: AiCredits | null;
  workspaceName: string;
  values: GenerateRequestBody;
  /** The strictest limit among the selected channels, worked out by the panel. */
  limit: CharacterLimit | null;
  running: boolean;
  onChange: (values: GenerateRequestBody) => void;
  onGenerate: (values: GenerateRequestBody) => void;
  onStop: () => void;
}) {
  const id = useId();
  const mounted = useMounted();
  const [attempted, setAttempted] = useState(false);

  const topic = values.topic.trim();
  const topicError =
    topic.length < TOPIC_MIN
      ? 'Give the post a topic. A few words is enough.'
      : topic.length > TOPIC_MAX
        ? `Keep the topic under ${TOPIC_MAX.toLocaleString()} characters.`
        : null;
  const channelError =
    values.channelIds.length === 0 ? 'Choose at least one channel to write for.' : null;

  const cost = credits ? generateCost(credits, values.withImage) : null;
  const cannotAfford = credits !== null && cost !== null && credits.remaining < cost;

  const update = (patch: Partial<GenerateRequestBody>) => onChange({ ...values, ...patch });

  return (
    <form
      aria-label="Generate a post"
      className="flex flex-col gap-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (!topicError && !channelError && !running && !cannotAfford) {
          onGenerate({ ...values, topic });
        }
      }}
    >
      <section className="flex flex-col gap-3">
        <StepHeader
          step={1}
          title={
            <label htmlFor={`${id}-topic`} className="cursor-pointer">
              Topic<span className="ms-1 text-dangerInk">*</span>
            </label>
          }
          aside={
            <span className="font-sans text-xs text-ink type-muted tabular-nums">
              {values.topic.length.toLocaleString()} / {TOPIC_MAX.toLocaleString()}
            </span>
          }
        />
        <Textarea
          id={`${id}-topic`}
          value={values.topic}
          onChange={(event) => update({ topic: event.target.value })}
          placeholder="Enter your topic, a link or a rough draft"
          rows={5}
          maxLength={TOPIC_MAX}
          variant={attempted && topicError ? 'error' : 'default'}
          aria-invalid={attempted && topicError ? true : undefined}
          aria-describedby={`${id}-topic-help`}
          disabled={running}
        />
        {attempted && topicError ? (
          <FormErrorMessage id={`${id}-topic-help`}>{topicError}</FormErrorMessage>
        ) : (
          <FormHelperText id={`${id}-topic-help`}>
            {status.research
              ? 'It is researched on the web first, so a few words is enough.'
              : 'A few words is enough. Add detail for a closer fit.'}
          </FormHelperText>
        )}
      </section>

      <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={running}>
        <legend className="contents">
          <StepHeader step={2} title="Voice" />
        </legend>
        <RadioGroup
          value={values.tone}
          onValueChange={(tone) => update({ tone: tone as Tone })}
          className="grid gap-3 sm:grid-cols-2"
          aria-label="Voice"
        >
          <ChoiceTile
            id={`${id}-personal`}
            value="personal"
            icon={User}
            title="Personal"
            hint="I and me, in your own voice."
          />
          <ChoiceTile
            id={`${id}-company`}
            value="company"
            icon={Building2}
            title="Company"
            hint={`We, in ${workspaceName}'s voice.`}
          />
        </RadioGroup>
      </fieldset>

      <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={running}>
        <legend className="contents">
          <StepHeader step={3} title="Format" />
        </legend>
        <RadioGroup
          value={values.format}
          onValueChange={(value) => {
            if (FORMATS.has(value)) {
              update({ format: value as PostFormat });
            }
          }}
          className="grid gap-3 sm:grid-cols-2"
          aria-label="Format"
        >
          {FORMAT_OPTIONS.map((option) => (
            <ChoiceTile
              key={option.value}
              id={`${id}-${option.value}`}
              value={option.value}
              icon={FORMAT_ICONS[option.value]}
              title={option.label}
              hint={option.hint}
            />
          ))}
        </RadioGroup>

        <div className={cn(INSET, 'flex items-center gap-3 p-4')}>
          <AiSticker icon={ImageIcon} tone={values.withImage ? 'ai' : 'plain'} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Label htmlFor={`${id}-image`}>Hero image</Label>
            <FormHelperText>
              {status.images
                ? `One image on the first part (+${credits?.costs.generate_image ?? 10} credits).`
                : 'Image generation is not available in this setup.'}
            </FormHelperText>
          </div>
          <Toggle
            id={`${id}-image`}
            checked={values.withImage}
            onCheckedChange={(withImage) => update({ withImage })}
            disabled={running || !status.images}
          />
        </div>
      </fieldset>

      <section className="flex flex-col gap-3">
        {/* ChannelPicker renders its own fieldset and legend ("Channels"), so
              this is the step's heading rather than a label for a control. */}
        <StepHeader
          step={4}
          title={
            <>
              Channels<span className="ms-1 text-dangerInk">*</span>
            </>
          }
        />
        <div className={cn(running && 'pointer-events-none opacity-70')}>
          <ChannelPicker
            orgId={orgId}
            channels={channels}
            selected={values.channelIds}
            onToggle={(channelId) =>
              update({
                channelIds: values.channelIds.includes(channelId)
                  ? values.channelIds.filter((item) => item !== channelId)
                  : [...values.channelIds, channelId],
              })
            }
          />
        </div>
        {attempted && channelError ? (
          <FormErrorMessage>{channelError}</FormErrorMessage>
        ) : limit ? (
          <FormHelperText>
            Fits {limit.platform}'s {limit.maxLength.toLocaleString()} characters
            {limit.lengthMethod === 'x-weighted' ? ', as X counts them' : ''}.
          </FormHelperText>
        ) : channels.length > 0 ? (
          <FormHelperText>The strictest platform you pick sets the length.</FormHelperText>
        ) : null}
      </section>

      {cannotAfford && credits && cost !== null ? (
        <Alert variant="warning">
          <div className="flex flex-col gap-1">
            <AlertTitle>Not enough credits</AlertTitle>
            <span>
              This generation costs {cost} and {credits.remaining}{' '}
              {credits.remaining === 1 ? 'remains' : 'remain'}. Credits reset{' '}
              {mounted ? formatResetDate(credits.resetsAt) : 'next cycle'}
              {values.withImage ? ', or drop the hero image.' : '.'}
            </span>
          </div>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="highlight"
            size="lg"
            disabled={running || cannotAfford || channels.length === 0}
            className="flex-1 sm:flex-none"
          >
            <MotionIcon icon={SparklesIcon} className="h-5 w-5" />
            {running
              ? 'Generating…'
              : cost === null
                ? 'Generate'
                : `Generate (${cost} ${cost === 1 ? 'Credit' : 'Credits'})`}
          </Button>
          {running ? (
            <Button type="button" variant="secondary" size="lg" onClick={onStop}>
              <MotionIcon icon={CircleStopIcon} className="h-4 w-4" />
              Stop
            </Button>
          ) : null}
        </div>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-xs text-ink type-muted">
          <span className="inline-flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            {status.research ? 'With web research' : 'Without web research'}
          </span>
          {status.model ? (
            <span className="inline-flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              {status.model}
            </span>
          ) : null}
        </span>
      </div>
    </form>
  );
}

/** A step's number sticker and name, with whatever reads on its right. */
function StepHeader({ step, title, aside }: { step: number; title: ReactNode; aside?: ReactNode }) {
  return (
    <span className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-3">
        <AiSticker size="sm" tone="plain">
          {step}
        </AiSticker>
        <span className="type-heading text-lg text-ink">{title}</span>
      </span>
      {aside}
    </span>
  );
}

/**
 * A selectable tile around a radio: the whole tile is the label, so a click
 * anywhere on it picks the option, and the radio keeps the keyboard
 * semantics. Chosen like the channel chips beside it: the blue fill moves to
 * its sticker and border, and it sinks into its shadow. Stacked (sticker and
 * radio on top, then the name and hint at the tile's full width) because the
 * brief is a narrow column, two tiles to a row.
 */
function ChoiceTile({
  id,
  value,
  icon,
  title,
  hint,
}: {
  id: string;
  value: string;
  icon: LucideIcon;
  title: string;
  hint: string;
}) {
  const Icon = icon;

  return (
    <label
      htmlFor={id}
      className={cn(
        INSET,
        'group relative flex cursor-pointer flex-col gap-3 p-4 shadow-brutalSm',
        'transition-[transform,box-shadow,background-color] duration-100 hover:bg-actionPrimary/10',
        'has-[[data-state=checked]]:translate-x-[2px] has-[[data-state=checked]]:translate-y-[2px]',
        'has-[[data-state=checked]]:border-actionPrimary has-[[data-state=checked]]:shadow-none',
        'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-clip-padding bg-secondary text-ink',
          'group-has-[[data-state=checked]]:bg-actionPrimary group-has-[[data-state=checked]]:text-onActionPrimary',
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={2.5} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="type-ui text-sm text-ink">{title}</span>
        <span className="font-sans text-xs text-ink type-muted">{hint}</span>
      </span>
      <RadioGroupItem id={id} value={value} className="absolute end-4 top-4" />
    </label>
  );
}
