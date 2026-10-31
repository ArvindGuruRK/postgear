/**
 * Module 12: Slack, Teams and Discord (providers) and Email (the API step gateway).
 *
 * Email does not leave through the worker: PostGear's own mail path lives
 * in the API (SMTP when `SMTP_HOST` is set, the API console otherwise), so
 * the step resolves and checks the recipients here and the gateway's
 * `POST /internal/automation/email` sends, one recipient at a time, with the
 * daily workspace cap and the effect ledger (a retry never emails anyone
 * twice). Under AUTOMATION_SIMULATION it still goes to the API, since that
 * is PostGear's own path and prints to the console without SMTP; the
 * `[simulate:...]` markers apply first, like every other outside step.
 */
import { LIMITS } from '@postgear/automation';
import type { AutomationDryRunOutput } from '@postgear/scheduling';
import { z } from 'zod';
import { simulatedOutcome } from '../../lib/simulation-markers';
import { StepFailure } from '../failures';
import { callGateway } from '../gateway-client';
import { discordProvider } from '../providers/discord';
import { previewOf } from '../providers/escape';
import { providerExecutor } from '../providers/provider-executor';
import { slackProvider } from '../providers/slack';
import { teamsProvider } from '../providers/teams';
import type { ExecContext, Executor } from './types';

export type EmailConfig = {
  to: string[];
  subject: string;
  message: string;
};

export interface EmailOutput {
  sent: number;
  /** Masked: `k***@example.com`. */
  recipients: string[];
}

const SUBJECT_MAX = 200;
const emailAddress = z.string().email().max(254);

/** "'kim@' is not an email address." (the value cut to 60 characters). */
export function notAnEmail(value: string): string {
  return `'${previewOf(value, 60)}' is not an email address.`;
}

/**
 * The addresses to write to: each resolved entry split on commas,
 * semicolons and spaces (a data chip may hold a list), blanks dropped,
 * repeats removed (case does not matter). Fails the step on a value that
 * is not an address, on none at all, and past the 10-person cap.
 */
export function emailRecipients(to: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of to) {
    const text = typeof entry === 'string' ? entry : entry == null ? '' : String(entry);
    for (const part of text.split(/[,;\s]+/)) {
      const value = part.trim();
      if (!value) continue;
      if (!emailAddress.safeParse(value).success) {
        throw new StepFailure('permanent', notAnEmail(value), 'invalid_email');
      }
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
  }
  if (out.length === 0) {
    throw new StepFailure('permanent', 'Add at least one email address.', 'missing_recipients');
  }
  if (out.length > LIMITS.maxEmailRecipients) {
    throw new StepFailure(
      'permanent',
      `An Email step can write to at most ${LIMITS.maxEmailRecipients} people.`,
      'too_many_recipients',
    );
  }
  return out;
}

/** The subject on one line (no header can be smuggled in), at most 200 characters. */
export function emailSubject(subject: string): string {
  const line = Array.from(
    subject
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  if (line.length === 0) {
    throw new StepFailure('permanent', 'Write a subject.', 'missing_subject');
  }
  return line.slice(0, SUBJECT_MAX).join('');
}

const people = (n: number) => (n === 1 ? '1 person' : `${n} people`);

/** Waits, heartbeating every second, until done or cancelled (`[simulate:slow]`). */
async function wait(seconds: number, ctx: ExecContext<unknown>): Promise<void> {
  const end = Date.now() + seconds * 1_000;
  while (Date.now() < end && !ctx.signal.aborted) {
    ctx.heartbeat();
    await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, end - Date.now())));
  }
}

/** What a `[simulate:...]` marker in the email forces; null to send. */
async function simulatedEmailFailure(
  text: string,
  ctx: ExecContext<unknown>,
): Promise<StepFailure | null> {
  const outcome = simulatedOutcome(text, ctx.attempt);
  if (!outcome) return null;
  switch (outcome.kind) {
    case 'retryable':
      return new StepFailure(
        'retryable',
        'PostGear could not send the email just now. It will try again (simulated).',
        outcome.status === 429 ? 'rate_limited' : 'unavailable',
      );
    case 'connectionBroken':
    case 'permanent':
      return new StepFailure(
        'permanent',
        'The mail server refused this email (simulated).',
        'rejected',
      );
    case 'slow':
      await wait(outcome.seconds, ctx);
      return null;
  }
}

export const emailExecutor: Executor<EmailConfig> = {
  type: 'notify.email',
  async run(ctx) {
    const to = emailRecipients(ctx.config.to ?? []);
    const subject = emailSubject(ctx.config.subject ?? '');
    const message = ctx.config.message ?? '';

    if (ctx.dryRun) {
      const output: AutomationDryRunOutput = {
        dryRun: true,
        wouldSend: `Would email ${people(to.length)}: ${subject}`,
      };
      return { output, status: 'dryRun' };
    }

    if (ctx.simulation) {
      ctx.log.info('automation.simulated_send', {
        runId: ctx.run.id,
        nodeKey: ctx.node.key,
        type: 'notify.email',
        summary: `Email to ${people(to.length)}: ${subject}`,
      });
      const failure = await simulatedEmailFailure(
        [...to, subject, message].join('\n'),
        ctx as ExecContext<unknown>,
      );
      if (failure) throw failure;
    }

    const result = await callGateway<EmailOutput>(ctx as ExecContext<unknown>, '/email', {
      to,
      subject,
      message,
    });
    return { output: result.output };
  },
};

export const NOTIFY_EXECUTORS: Executor[] = [
  providerExecutor('notify.slack', slackProvider),
  providerExecutor('notify.teams', teamsProvider),
  providerExecutor('notify.discord', discordProvider),
  emailExecutor,
];
