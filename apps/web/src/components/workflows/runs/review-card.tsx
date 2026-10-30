'use client';

/**
 * A Manual Review step's card (Module 08, WF-10.1): the content sent for
 * review, the instructions, the expiry, and Approve, Edit Then Approve and
 * Reject; once answered, who decided and when. Shown in the Runs tab and on
 * the builder while a test run waits.
 *
 * Each answer is sent once (every button is disabled while it travels). A
 * 409 `review_answered` means someone else was first: the card says so and
 * asks its owner to refresh, which brings their answer in. Rejected is an
 * outcome, not a failure, so it never wears the danger colour.
 */
import { CheckIcon } from '@animateicons/react/lucide/check-icon';
import { PencilIcon } from '@animateicons/react/lucide/pencil-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import { Alert, Badge, Button, cn, MotionIcon, Text, Textarea } from '@postgear/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { answerReview, type ReviewRequest } from '@/lib/workflows-api';
import type { ReviewAnswer, ReviewOutput, RunStep } from '@/types/workflows';
import {
  decidedText,
  REVIEW_ANSWERED_ELSEWHERE,
  REVIEW_CLOSED,
  reviewContent,
  reviewExpiryText,
  reviewOutputOf,
} from './review-words';

export interface ReviewCardProps {
  runId: string;
  /** The Manual Review step, waiting or answered. */
  step: RunStep;
  /** After an answer was recorded, or someone else's answer was found (null). */
  onAnswered?: (answer: ReviewAnswer | null) => void;
  autoFocus?: boolean;
  className?: string;
}

type Mode = 'choose' | 'edit' | 'reject';

function ReviewContentView({ step }: { step: RunStep }) {
  const content = reviewContent(step.input);
  return (
    <>
      {content.instructions ? <Text size="sm">{content.instructions}</Text> : null}
      {content.text ? (
        <blockquote className="whitespace-pre-wrap break-words rounded-md border-2 border-outline bg-inset p-3 font-sans text-sm text-ink">
          {content.text}
        </blockquote>
      ) : null}
      {content.image ? (
        // A workspace media link of any size: the optimiser would need every host listed.
        // biome-ignore lint/performance/noImgElement: see above
        <img
          src={content.image}
          alt="Sent for review"
          className="max-h-64 w-auto self-start rounded-md border-2 border-outline object-contain"
        />
      ) : null}
      {!content.text && !content.image ? (
        <Text size="sm" muted>
          Nothing was sent with this review.
        </Text>
      ) : null}
    </>
  );
}

export function ReviewCard({ runId, step, onAnswered, autoFocus, className }: ReviewCardProps) {
  // This browser's own answer shows at once; the step's stored one (with the
  // reviewer's name) replaces it when the run is fetched again.
  const [mine, setMine] = useState<ReviewOutput | null>(null);
  const answer = reviewOutputOf(step.output) ?? mine;
  const waiting = step.status === 'WAITING' && !answer;
  const [mode, setMode] = useState<Mode>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [edited, setEdited] = useState(() => reviewContent(step.input).text);
  const [reason, setReason] = useState('');
  const first = useRef<HTMLButtonElement>(null);
  const sending = useRef(false);
  const editId = useId();
  const reasonId = useId();

  useEffect(() => {
    if (autoFocus && waiting) first.current?.focus();
  }, [autoFocus, waiting]);

  async function send(body: ReviewRequest) {
    // A second press while the first is on its way changes nothing.
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const recorded = await answerReview(runId, step.nodeKey, body);
      setMine({
        decision: recorded.decision,
        decidedAt: recorded.decidedAt,
        ...(body.editedText ? { editedText: body.editedText } : {}),
        ...(body.reason ? { reason: body.reason } : {}),
      });
      onAnswered?.(recorded);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'review_answered') {
        setNotice(REVIEW_ANSWERED_ELSEWHERE);
        onAnswered?.(null);
      } else {
        setError(cause instanceof Error ? cause.message : 'Your answer was not saved. Try again.');
        sending.current = false;
      }
    } finally {
      setBusy(false);
    }
  }

  const frame = cn(
    'flex flex-col gap-3 rounded-card border-2 border-outline bg-secondary p-4 shadow-surfaceSm',
    className,
  );

  if (answer) {
    const approved = answer.decision === 'approved';
    return (
      <section aria-label={`${step.nodeName} review`} className={frame} data-testid="review-card">
        <div className="flex flex-wrap items-center gap-2">
          {approved ? (
            <Badge variant="success">Approved</Badge>
          ) : (
            <Badge variant="outline">Rejected</Badge>
          )}
          <Text size="sm" as="span" data-testid="review-decided">
            {decidedText(answer)}
          </Text>
        </div>
        {notice ? <Alert variant="default">{notice}</Alert> : null}
        {!approved && answer.reason ? <Text size="sm">Reason: {answer.reason}</Text> : null}
        {approved && answer.editedText ? (
          <>
            <Text size="sm" muted>
              Approved with this edited text:
            </Text>
            <blockquote className="whitespace-pre-wrap break-words rounded-md border-2 border-outline bg-inset p-3 font-sans text-sm text-ink">
              {answer.editedText}
            </blockquote>
          </>
        ) : (
          <ReviewContentView step={step} />
        )}
      </section>
    );
  }

  if (!waiting) {
    return (
      <section aria-label={`${step.nodeName} review`} className={frame} data-testid="review-card">
        <Text size="sm" muted>
          {notice ?? REVIEW_CLOSED}
        </Text>
        <ReviewContentView step={step} />
      </section>
    );
  }

  return (
    <section aria-label={`${step.nodeName} review`} className={frame} data-testid="review-card">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Waiting For Review</Badge>
        <Text size="sm" as="span" muted>
          {reviewExpiryText(step.startedAt)}
        </Text>
      </div>

      <ReviewContentView step={step} />

      {notice ? <Alert variant="default">{notice}</Alert> : null}
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {mode === 'choose' ? (
        <div className="flex flex-wrap gap-2">
          <Button
            ref={first}
            size="sm"
            disabled={busy}
            onClick={() => void send({ decision: 'approved' })}
          >
            <MotionIcon icon={CheckIcon} className="h-4 w-4" />
            Approve
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setMode('edit')}>
            <MotionIcon icon={PencilIcon} className="h-4 w-4" />
            Edit Then Approve
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setMode('reject')}>
            <MotionIcon icon={XIcon} className="h-4 w-4" />
            Reject
          </Button>
        </div>
      ) : null}

      {mode === 'edit' ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={editId} className="font-sans text-sm font-bold text-ink">
            Text to approve
          </label>
          <Textarea
            id={editId}
            value={edited}
            onChange={(event) => setEdited(event.target.value)}
            placeholder="Enter your text"
            disabled={busy}
            autoFocus
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || edited.trim() === ''}
              onClick={() => void send({ decision: 'approved', editedText: edited })}
            >
              <MotionIcon icon={CheckIcon} className="h-4 w-4" />
              {busy ? 'Approving...' : 'Approve Edited Text'}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => setMode('choose')}>
              Back
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'reject' ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={reasonId} className="font-sans text-sm font-bold text-ink">
            Reason (optional)
          </label>
          <Textarea
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Enter your reason"
            disabled={busy}
            autoFocus
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() =>
                void send({
                  decision: 'rejected',
                  ...(reason.trim() ? { reason: reason.trim() } : {}),
                })
              }
            >
              <MotionIcon icon={XIcon} className="h-4 w-4" />
              {busy ? 'Rejecting...' : 'Reject'}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => setMode('choose')}>
              Back
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
