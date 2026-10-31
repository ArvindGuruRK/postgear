/**
 * Starter templates: finished workflows that only ask for the missing
 * pieces (a connection, a channel, a spreadsheet). Each is graph JSON
 * laid out left to right on a 320 px grid so it opens tidy, and each
 * validates clean once those pieces are filled (a unit test checks).
 *
 * Keys here are fixed and readable; `instantiateTemplate` gives every
 * new workflow fresh ones.
 */
import { getDefinition, nodeTitle } from '../catalog';
import type { ConnectionKind, IconKey, NodeType } from '../catalog/types';
import type { ConditionGroup } from '../conditions/schema';
import { rekeyGraph } from '../graph/rekey';
import {
  type AutomationGraph,
  edgeId,
  GRAPH_SCHEMA_VERSION,
  type GraphEdge,
  type GraphNode,
  type PortId,
} from '../graph/schema';

/** What a template asks for before it can run: a connection kind, or a channel. */
export type TemplateNeed = ConnectionKind | 'channel';

export type TemplateCategory = 'reporting' | 'ai' | 'alerts' | 'repurpose';

export interface AutomationTemplate {
  id: string;
  /** Title Case. */
  title: string;
  /** Sentence case, one line. */
  description: string;
  /** Icons for the card, in flow order. */
  apps: IconKey[];
  category: TemplateCategory;
  needs: TemplateNeed[];
  priority: 'P0' | 'P1';
  graph: AutomationGraph;
}

/** A template without its graph, for the list. */
export type TemplateSummary = Omit<AutomationTemplate, 'graph'> & { steps: number };

export const TEMPLATE_COLUMN = 320;
export const TEMPLATE_ROW = 160;

function step(
  key: string,
  type: NodeType,
  column: number,
  config: Record<string, unknown> = {},
  options: { name?: string; row?: number } = {},
): GraphNode {
  const def = getDefinition(type);
  if (!def) throw new Error(`No definition for ${type}`);
  const defaults = JSON.parse(JSON.stringify(def.defaultConfig)) as Record<string, unknown>;
  const merged = { ...defaults, ...config };
  return {
    key,
    type,
    typeVersion: def.typeVersion,
    name: options.name ?? nodeTitle(type, merged),
    position: { x: column * TEMPLATE_COLUMN, y: (options.row ?? 0) * TEMPLATE_ROW },
    config: merged,
  };
}

function line(source: string, target: string, sourcePort: PortId = 'out'): GraphEdge {
  return { id: edgeId(source, sourcePort, target), source, sourcePort, target, targetPort: 'in' };
}

function graph(nodes: GraphNode[], edges: GraphEdge[]): AutomationGraph {
  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes, edges, notes: [] };
}

const publishingReport: AutomationTemplate = {
  id: 'publishing-report',
  title: 'Publishing Report',
  description: 'Logs every published post to a Google Sheet and tells your team in Slack.',
  apps: ['post-published', 'set-fields', 'google-sheets', 'slack'],
  category: 'reporting',
  needs: ['google', 'slack'],
  priority: 'P0',
  graph: graph(
    [
      step('published', 'trigger.postPublished', 0),
      step('fields', 'logic.setFields', 1, {
        fields: [
          { name: 'date', type: 'text', value: '{{ trigger.publishedAt | date: "yyyy-MM-dd" }}' },
          { name: 'channel', type: 'text', value: '{{ trigger.post.channel.name }}' },
          { name: 'link', type: 'text', value: '{{ trigger.post.url }}' },
          { name: 'preview', type: 'text', value: '{{ trigger.post.preview | truncate: 100 }}' },
        ],
      }),
      step('sheet', 'data.googleSheetsAppendRow', 2, {
        columns: [
          { header: 'Date', value: '{{ nodes.fields.output.date }}' },
          { header: 'Channel', value: '{{ nodes.fields.output.channel }}' },
          { header: 'Link', value: '{{ nodes.fields.output.link }}' },
          { header: 'Preview', value: '{{ nodes.fields.output.preview }}' },
        ],
      }),
      step('slack', 'notify.slack', 3, {
        message: 'New post on {{ nodes.fields.output.channel }}: {{ nodes.fields.output.link }}',
      }),
    ],
    [line('published', 'fields'), line('fields', 'sheet'), line('sheet', 'slack')],
  ),
};

const aiWeeklyPost: AutomationTemplate = {
  id: 'ai-weekly-post',
  title: 'AI Weekly Post',
  description:
    'Every Monday, AI writes a post with an image; you approve it and it lands in Drafts.',
  apps: ['schedule', 'sparkles', 'image', 'review', 'draft', 'bell'],
  category: 'ai',
  needs: ['channel'],
  priority: 'P0',
  graph: graph(
    [
      step('monday', 'trigger.schedule', 0, {
        frequency: 'weekly',
        days: ['mon'],
        time: '09:00',
        timeZone: 'UTC',
      }),
      step('write', 'ai.generateText', 1, {
        prompt:
          'Write this week’s post for {{ workspace.name }}: one useful tip our followers can try today.',
      }),
      step('picture', 'ai.generateImage', 2, {
        prompt: 'An image for this post: {{ nodes.write.output.text | truncate: 300 }}',
        style: 'photo',
      }),
      step('review', 'logic.manualReview', 3, {
        text: '{{ nodes.write.output.text }}',
        image: '{{ nodes.picture.output.image }}',
        instructions: 'Check the post and the image. Approve to save them to Drafts.',
      }),
      step('draft', 'postgear.createDraft', 4, {
        text: '{{ nodes.review.output.text }}',
        media: '{{ nodes.picture.output.image }}',
      }),
      step('tell', 'notify.inApp', 5, {
        title: 'This week’s post is in Drafts',
        message: 'Open it to schedule it.',
        link: '{{ nodes.draft.output.link }}',
      }),
    ],
    [
      line('monday', 'write'),
      line('write', 'picture'),
      line('picture', 'review'),
      line('review', 'draft', 'approved'),
      line('draft', 'tell'),
    ],
  ),
};

const notGaveUp: ConditionGroup = {
  match: 'all',
  rules: [
    {
      id: 'reason',
      left: '{{ trigger.error.reason }}',
      operator: 'isNot',
      right: 'retries_exhausted',
    },
  ],
};

const failedPostAlert: AutomationTemplate = {
  id: 'failed-post-alert',
  title: 'Failed Post Alert',
  description: 'Tells you in Slack and in PostGear when a post fails for a reason you can fix.',
  apps: ['post-failed', 'filter', 'slack', 'bell'],
  category: 'alerts',
  needs: ['slack'],
  priority: 'P0',
  graph: graph(
    [
      step('failed', 'trigger.postFailed', 0),
      step('check', 'logic.filter', 1, { condition: notGaveUp }, { name: 'Needs A Fix' }),
      step('slack', 'notify.slack', 2, {
        message:
          'A post on {{ trigger.post.channel.name }} failed: {{ trigger.error.reasonText }}. {{ trigger.link }}',
      }),
      step(
        'tell',
        'notify.inApp',
        2,
        {
          title: 'A post failed on {{ trigger.post.channel.name }}',
          message: '{{ trigger.error.reasonText }}',
          link: '{{ trigger.link }}',
        },
        { row: 1 },
      ),
    ],
    [line('failed', 'check'), line('check', 'slack'), line('check', 'tell')],
  ),
};

const repurposeForX: AutomationTemplate = {
  id: 'repurpose-for-x',
  title: 'Repurpose For X',
  description:
    'Turns each new LinkedIn post into an X draft in your brand voice, after you approve it.',
  apps: ['post-published', 'wand', 'review', 'draft'],
  category: 'repurpose',
  needs: ['channel'],
  priority: 'P1',
  graph: graph(
    [
      step('linkedin', 'trigger.postPublished', 0, {}, { name: 'LinkedIn Post Published' }),
      step('rewrite', 'ai.rewriteInBrandVoice', 1, {
        text: '{{ trigger.post.preview }}',
        platform: 'x',
      }),
      step('review', 'logic.manualReview', 2, {
        text: '{{ nodes.rewrite.output.text }}',
        instructions: 'Check the X version. Approve to save it to Drafts.',
      }),
      step('draft', 'postgear.createDraft', 3, { text: '{{ nodes.review.output.text }}' }),
    ],
    [line('linkedin', 'rewrite'), line('rewrite', 'review'), line('review', 'draft', 'approved')],
  ),
};

const blogToDraft: AutomationTemplate = {
  id: 'blog-to-draft',
  title: 'Blog To Draft',
  description:
    'When your blog sends a new article, AI writes a post about it and saves it to Drafts.',
  apps: ['webhook', 'sparkles', 'draft', 'bell'],
  category: 'repurpose',
  needs: ['channel'],
  priority: 'P1',
  graph: graph(
    [
      step('blog', 'trigger.webhook', 0, {}, { name: 'New Blog Article' }),
      step('write', 'ai.generateText', 1, {
        prompt:
          'Write a post that shares this new article: {{ trigger.body.title }} {{ trigger.body.url }}',
      }),
      step('draft', 'postgear.createDraft', 2, { text: '{{ nodes.write.output.text }}' }),
      step('tell', 'notify.inApp', 3, {
        title: 'A new draft from your blog',
        message: '{{ trigger.body.title }}',
        link: '{{ nodes.draft.output.link }}',
      }),
    ],
    [line('blog', 'write'), line('write', 'draft'), line('draft', 'tell')],
  ),
};

/** Every starter, in the order the gallery shows them. */
export const TEMPLATES: readonly AutomationTemplate[] = [
  publishingReport,
  aiWeeklyPost,
  failedPostAlert,
  repurposeForX,
  blogToDraft,
];

export function getTemplate(id: string): AutomationTemplate | undefined {
  return TEMPLATES.find((template) => template.id === id);
}

export function listTemplates(): TemplateSummary[] {
  return TEMPLATES.map(({ graph: templateGraph, ...meta }) => ({
    ...meta,
    apps: [...meta.apps],
    needs: [...meta.needs],
    steps: templateGraph.nodes.length,
  }));
}

export interface InstantiateOptions {
  /** IANA zone for Schedule and Add To Queue steps (the browser's, usually). */
  timeZone?: string;
}

/**
 * A new workflow's graph from a template: a deep copy with fresh keys from
 * `makeKey` (data chips follow them) and the caller's time zone.
 */
export function instantiateTemplate(
  template: AutomationTemplate,
  makeKey: (oldKey: string) => string,
  options: InstantiateOptions = {},
): AutomationGraph {
  const copy = rekeyGraph(JSON.parse(JSON.stringify(template.graph)) as AutomationGraph, makeKey);
  if (!options.timeZone) return copy;
  return {
    ...copy,
    nodes: copy.nodes.map((node) =>
      node.type === 'trigger.schedule' || node.type === 'postgear.addToQueue'
        ? { ...node, config: { ...node.config, timeZone: options.timeZone } }
        : node,
    ),
  };
}
