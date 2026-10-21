'use client';

/**
 * The generate form: topic, voice, format, hero image, channels, and the
 * price of pressing the button.
 *
 * Controlled from the panel above it, which keeps the values so "Regenerate"
 * on the result can send exactly what was asked. The form validates what the
 * API will (topic 3–2000 characters, at least one channel) before sending,
 * so a refusal that could be seen coming is shown next to the field rather
 * than as a 400 after the fact; the API still has the final say.
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
  FormField,
  FormHelperText,
  FormLabel,
  Label,
  MotionIcon,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
  Textarea,
  Toggle,
} from '@postgear/ui';
import { useId, useState } from 'react';
import type { AiCredits, AiStatus, GenerateRequestBody, PostFormat, Tone } from '@/types/ai';
import type { Channel } from '@/types/channel';
import { ChannelPicker } from '../composer/channel-picker';
import { useMounted } from '../posts/use-mounted';
import { formatResetDate } from './credits-meter';
import { type CharacterLimit, FORMAT_OPTIONS, generateCost } from './generate-state';

export const TOPIC_MIN = 3;
export const TOPIC_MAX = 2000;

const FORMATS = new Set<string>(FORMAT_OPTIONS.map((option) => option.value));

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
  const format = FORMAT_OPTIONS.find((option) => option.value === values.format);

  const update = (patch: Partial<GenerateRequestBody>) => onChange({ ...values, ...patch });

  return (
    <form
      aria-label="Generate a post"
      className="flex flex-col gap-5 rounded-lg border-2 border-outline bg-secondary p-5 shadow-surfaceMd"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (!topicError && !channelError && !running && !cannotAfford) {
          onGenerate({ ...values, topic });
        }
      }}
    >
      <FormField>
        <FormLabel htmlFor={`${id}-topic`} required>
          Topic
        </FormLabel>
        <Textarea
          id={`${id}-topic`}
          value={values.topic}
          onChange={(event) => update({ topic: event.target.value })}
          placeholder="What should the post say? A topic, a link, a rough draft…"
          rows={4}
          maxLength={TOPIC_MAX}
          variant={attempted && topicError ? 'error' : 'default'}
          aria-invalid={attempted && topicError ? true : undefined}
          disabled={running}
        />
        {attempted && topicError ? (
          <FormErrorMessage>{topicError}</FormErrorMessage>
        ) : (
          <FormHelperText>
            {values.topic.length.toLocaleString()} / {TOPIC_MAX.toLocaleString()}
          </FormHelperText>
        )}
      </FormField>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" disabled={running}>
        <legend className="mb-2 font-sans text-sm font-bold text-ink">Voice</legend>
        <RadioGroup
          value={values.tone}
          onValueChange={(tone) => update({ tone: tone as Tone })}
          className="grid gap-3 sm:grid-cols-2"
          aria-label="Voice"
        >
          <VoiceCard
            id={`${id}-personal`}
            value="personal"
            title="Personal"
            hint="I and me, in your own voice."
          />
          <VoiceCard
            id={`${id}-company`}
            value="company"
            title="Company"
            hint={`We, in ${workspaceName}'s voice.`}
          />
        </RadioGroup>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField>
          <FormLabel htmlFor={`${id}-format`}>Format</FormLabel>
          <Select
            value={values.format}
            onValueChange={(value) => {
              if (FORMATS.has(value)) {
                update({ format: value as PostFormat });
              }
            }}
            disabled={running}
          >
            <SelectTrigger id={`${id}-format`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMAT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormHelperText>{format?.hint}</FormHelperText>
        </FormField>

        <div className="flex items-start justify-between gap-4 rounded-md border-2 border-outline p-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-image`}>Hero image</Label>
            <FormHelperText>
              {status.images
                ? `One image on the first part (+${credits?.costs.generate_image ?? 10} credits)`
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
      </div>

      <div className="flex flex-col gap-2">
        {/* ChannelPicker renders its own fieldset and legend, so this is a
            heading for it rather than a label for a control: the Label
            classes, copied per design-system-rules.md §1. */}
        <span className="font-sans text-sm font-bold text-ink">
          Channels<span className="ml-1 text-dangerInk">*</span>
        </span>
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
      </div>

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

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="highlight"
          disabled={running || cannotAfford || channels.length === 0}
        >
          <MotionIcon icon={SparklesIcon} className="h-4 w-4" />
          {running
            ? 'Generating…'
            : cost === null
              ? 'Generate'
              : `Generate (${cost} ${cost === 1 ? 'credit' : 'credits'})`}
        </Button>
        {running ? (
          <Button type="button" variant="secondary" onClick={onStop}>
            <MotionIcon icon={CircleStopIcon} className="h-4 w-4" />
            Stop
          </Button>
        ) : null}
        <Text size="sm" muted className="sm:ms-auto">
          {status.research ? 'With web research' : 'Without web research'}
          {status.model ? `, ${status.model}` : ''}
        </Text>
      </div>
    </form>
  );
}

/**
 * A selectable card around a radio: the whole card is the label, so a click
 * anywhere on it picks the voice, and the radio keeps the keyboard semantics.
 */
function VoiceCard({
  id,
  value,
  title,
  hint,
}: {
  id: string;
  value: Tone;
  title: string;
  hint: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-md border-2 border-outline bg-secondary p-4 shadow-surfaceSm',
        'transition-colors hover:bg-actionPrimary/10 has-[[data-state=checked]]:bg-actionPrimary/10',
      )}
    >
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <span className="flex flex-col gap-0.5">
        <span className="type-heading text-base text-ink">{title}</span>
        <span className="font-sans text-xs font-medium text-ink opacity-70">{hint}</span>
      </span>
    </label>
  );
}
