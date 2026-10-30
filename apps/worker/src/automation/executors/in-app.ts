/**
 * In-App Notification: a `Notifications` row for the whole workspace (every
 * member sees it in the bell), written the way the worker writes its other
 * notifications (`integration.activities.ts`): `emailStatus: PENDING`, so
 * the API's outbox emails it to whoever asked for that.
 *
 * It stays inside PostGear, so a test run sends it for real, with "(Test)"
 * after the title.
 */
import { toText } from '@postgear/automation';
import { AUTOMATION_NOTIFICATION_TYPES } from '@postgear/scheduling';
import type { Executor } from './types';

const TITLE_MAX = 200;
const MESSAGE_MAX = 2_000;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** The link to the run in the workflow's Runs tab (Module 08's deep link). */
export function runLink(organizationId: string, automationId: string, runId: string): string {
  return `/${organizationId}/workflows/${automationId}?tab=runs&run=${encodeURIComponent(runId)}`;
}

/** The link that opens a waiting Manual Review's card straight away. */
export function reviewLink(organizationId: string, automationId: string, runId: string): string {
  return `${runLink(organizationId, automationId, runId)}&review=1`;
}

/**
 * A link the user typed (or filled from data): an app path or a web link.
 * Anything else (`javascript:`, `//host`) falls back to the run's own page.
 */
function safeLink(value: unknown): string | null {
  const text = toText(value).trim();
  if (!text || text.length > 500) return null;
  if (text.startsWith('/') && !text.startsWith('//')) return text;
  if (/^https?:\/\/[^\s]+$/i.test(text)) return text;
  return null;
}

export const inAppExecutor: Executor = {
  type: 'notify.inApp',
  async run(ctx) {
    const title = clip(toText(ctx.config.title).trim(), TITLE_MAX) || ctx.node.name;
    const shownTitle = ctx.run.mode === 'test' ? `${title} (Test)` : title;
    const message = clip(toText(ctx.config.message).trim(), MESSAGE_MAX);
    const link =
      safeLink(ctx.config.link) ??
      runLink(ctx.run.organizationId, ctx.run.automationId, ctx.run.id);

    const { id } = await ctx.deps.store.createNotification({
      organizationId: ctx.run.organizationId,
      type: AUTOMATION_NOTIFICATION_TYPES.message,
      title: shownTitle,
      content: message,
      link,
      meta: {
        automationId: ctx.run.automationId,
        automationName: ctx.run.automationName,
        runId: ctx.run.id,
        nodeKey: ctx.node.key,
        mode: ctx.run.mode,
      },
    });

    return { output: { sent: true, title: shownTitle, notificationId: id } };
  },
};
