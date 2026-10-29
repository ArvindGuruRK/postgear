/**
 * A workflow in plain words, for the activation dialog: what starts it,
 * what it does outside itself, and what could surprise someone (posts
 * going out without a review, credits spent per run).
 */
import { getDefinition, outputPortsOf, parseNodeConfig } from '../catalog';
import { channelNames, count } from '../catalog/fields';
import type { SummaryContext } from '../catalog/types';
import type { AutomationGraph, GraphNode } from '../graph/schema';
import { buildIndex } from '../plan/build-index';
import { describeSchedule, listWords } from '../schedule/describe';
import type { ScheduleConfig } from '../schedule/schema';
import { asRecord } from '../validate/config-paths';

export interface NodeRef {
  key: string;
  name: string;
  type: string;
}

/** Phrases spelled out before "and 2 more steps". */
const SHOWN_PHRASES = 3;

function triggerPhrase(node: GraphNode, ctx: SummaryContext): string {
  const parsed = parseNodeConfig(node);
  const config = parsed?.success ? asRecord(parsed.data) : {};
  switch (node.type) {
    case 'trigger.postPublished': {
      const channels = Array.isArray(config.channels) ? (config.channels as string[]) : [];
      return channels.length
        ? `When a post is published on ${channelNames(channels, ctx)}`
        : 'When a post is published';
    }
    case 'trigger.postFailed':
      return 'When a post fails to publish';
    case 'trigger.schedule':
      return parsed?.success ? describeSchedule(parsed.data as ScheduleConfig) : 'On a schedule';
    case 'trigger.manual':
      return 'When you click Run Now';
    case 'trigger.webhook':
      return 'When another app sends data to it';
    default:
      return 'When it starts';
  }
}

function hostOf(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  return /^https?:\/\/([^/?#\s{}]+)/i.exec(url.trim())?.[1];
}

/** What one step does to the world, or nothing for steps that only think. */
function stepPhrase(node: GraphNode, ctx: SummaryContext): string | undefined {
  const config = asRecord(node.config);
  const channels = Array.isArray(config.channels) ? (config.channels as string[]) : [];
  const where = channels.length ? channelNames(channels, ctx) : 'a channel';
  switch (node.type) {
    case 'postgear.publish':
      return `publish to ${where}`;
    case 'postgear.addToQueue':
      return `queue a post on ${where}`;
    case 'postgear.createDraft':
      return 'create a draft';
    case 'notify.inApp':
      return 'send an in-app notification';
    case 'notify.slack':
      return 'send a Slack message';
    case 'notify.teams':
      return 'send a Microsoft Teams message';
    case 'notify.discord':
      return 'send a Discord message';
    case 'notify.email': {
      const to = Array.isArray(config.to) ? config.to.length : 0;
      return to ? `email ${count(to, 'person', 'people')}` : 'send an email';
    }
    case 'data.googleSheetsAppendRow': {
      const name = asRecord(config.spreadsheet).name;
      return typeof name === 'string' && name
        ? `add a row to ${name}`
        : 'add a row to a Google Sheet';
    }
    case 'data.httpRequest': {
      const host = hostOf(config.url);
      return host ? `send data to ${host}` : 'send data to another app';
    }
    default:
      return undefined;
  }
}

function rank(node: GraphNode): number {
  const def = getDefinition(node.type, node.typeVersion);
  if (def?.publishes) return 0;
  return def?.sideEffect === 'external' ? 1 : 2;
}

/**
 * The activation sentence: "When a post is published, this workflow will
 * add a row to Social Report 2026, send a Slack message and publish to 2
 * channels." Posting comes first, then what leaves PostGear, then the rest;
 * three phrases at most, then "and 2 more steps".
 */
export function describeWorkflow(graph: AutomationGraph, ctx: SummaryContext = {}): string {
  const index = buildIndex(graph);
  const trigger = index.triggers[0];
  if (!trigger) return 'This workflow has no trigger yet.';
  const when = triggerPhrase(trigger, ctx);

  const steps = index.order
    .map((key) => index.nodes.get(key) as GraphNode)
    .filter((node) => node.key !== trigger.key && !node.disabled);
  const doing = steps
    .map((node, position) => ({ node, position, phrase: stepPhrase(node, ctx) }))
    .filter((entry): entry is typeof entry & { phrase: string } => entry.phrase !== undefined)
    .sort((a, b) => rank(a.node) - rank(b.node) || a.position - b.position);
  const phrases = [...new Set(doing.map((entry) => entry.phrase))];

  if (phrases.length === 0) {
    return steps.length
      ? `${when}, this workflow will run ${count(steps.length, 'step')}.`
      : `${when}, this workflow will not do anything yet.`;
  }
  const shown = phrases.slice(0, SHOWN_PHRASES);
  const more = phrases.length - shown.length;
  const list = more > 0 ? `${shown.join(', ')} and ${count(more, 'more step')}` : listWords(shown);
  return `${when}, this workflow will ${list}.`;
}

export interface RiskSummary {
  /** Steps that leave PostGear (Slack, Sheets, HTTP, Email). */
  external: NodeRef[];
  /** Steps that make posts go out (Publish, Add To Queue). */
  publishes: NodeRef[];
  /**
   * True when a post can go out on some path from the trigger without
   * passing an approved Manual Review: the activation dialog's extra tick.
   */
  publishesWithoutReview: boolean;
  /** Credits one run can spend at most (every AI step, every branch). */
  aiCreditsPerRun: number;
}

const ref = (node: GraphNode): NodeRef => ({ key: node.key, name: node.name, type: node.type });

export function riskSummary(graph: AutomationGraph): RiskSummary {
  const index = buildIndex(graph);
  const live = graph.nodes.filter((node) => !node.disabled);
  const defs = new Map(live.map((node) => [node.key, getDefinition(node.type, node.typeVersion)]));

  let credits = 0;
  for (const node of live) {
    const def = defs.get(node.key);
    if (!def?.credits) continue;
    const parsed = def.configSchema.safeParse(node.config);
    credits += def.credits(parsed.success ? parsed.data : def.defaultConfig);
  }

  // Walk from the trigger; an approved review stops the walk on that path.
  let unreviewed = false;
  const trigger = index.triggers[0];
  if (trigger) {
    const seen = new Set<string>();
    const queue = [trigger.key];
    while (queue.length > 0 && !unreviewed) {
      const key = queue.shift() as string;
      if (seen.has(key)) continue;
      seen.add(key);
      const node = index.nodes.get(key);
      if (!node) continue;
      if (!node.disabled && getDefinition(node.type, node.typeVersion)?.publishes) {
        unreviewed = true;
        break;
      }
      const ports = outputPortsOf(node).map((port) => port.id);
      for (const edge of index.outgoing.get(key) ?? []) {
        if (node.type === 'logic.manualReview' && edge.sourcePort === 'approved') continue;
        if (ports.includes(edge.sourcePort)) queue.push(edge.target);
      }
    }
  }

  return {
    external: live.filter((node) => defs.get(node.key)?.sideEffect === 'external').map(ref),
    publishes: live.filter((node) => defs.get(node.key)?.publishes).map(ref),
    publishesWithoutReview: unreviewed,
    aiCreditsPerRun: credits,
  };
}
