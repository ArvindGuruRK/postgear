import { ICON_KEYS } from '../catalog/types';
import { describeWorkflow, riskSummary } from '../describe';
import { type AutomationGraph, automationGraphSchema } from '../graph/schema';
import { sampleScope } from '../samples';
import { graphOf, line, step } from '../testing/builders';
import { tokensIn } from '../tokens/parse';
import { resolveConfig } from '../tokens/resolve';
import type { ValidationContext } from '../validate/types';
import { validateGraph } from '../validate/validate-graph';
import {
  getTemplate,
  instantiateTemplate,
  listTemplates,
  TEMPLATE_COLUMN,
  TEMPLATES,
} from './index';

const CTX: ValidationContext = {
  connections: [
    { id: 'conn_slack', kind: 'slack', name: 'Marketing Slack', status: 'CONNECTED' },
    { id: 'conn_google', kind: 'google', name: 'Bloom Google', status: 'CONNECTED' },
  ],
  channels: [{ id: 'ch_ig', provider: 'instagram', name: 'Bloom Bakery', status: 'active' }],
};

/** What the Finish Setup checklist asks for, filled in. */
function finishSetup(graph: AutomationGraph): AutomationGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const config = { ...node.config };
      if (node.type === 'notify.slack') config.connectionId = 'conn_slack';
      if (node.type === 'data.googleSheetsAppendRow') {
        config.connectionId = 'conn_google';
        config.spreadsheet = { id: 'sheet_1', name: 'Social Report 2026' };
        config.sheet = { id: 0, title: 'Posts' };
      }
      if (node.type === 'postgear.createDraft') config.channels = ['ch_ig'];
      return { ...node, config };
    }),
  };
}

const keyMaker = () => {
  let n = 0;
  return () => {
    n += 1;
    return `fresh${String(n).padStart(4, '0')}`;
  };
};

describe('starter templates', () => {
  it('ships the five planned templates, P0 first', () => {
    expect(TEMPLATES.map((t) => [t.id, t.priority])).toEqual([
      ['publishing-report', 'P0'],
      ['ai-weekly-post', 'P0'],
      ['failed-post-alert', 'P0'],
      ['repurpose-for-x', 'P1'],
      ['blog-to-draft', 'P1'],
    ]);
  });

  it.each(TEMPLATES.map((t) => [t.title, t] as const))(
    '%s is a valid graph laid out on the 320 px grid',
    (_title, template) => {
      expect(automationGraphSchema.safeParse(template.graph).success).toBe(true);
      for (const node of template.graph.nodes) {
        expect(node.position.x % TEMPLATE_COLUMN).toBe(0);
      }
      for (const app of template.apps) expect(ICON_KEYS).toContain(app);
    },
  );

  it.each(TEMPLATES.map((t) => [t.title, t] as const))(
    '%s has no errors once its connections and channels are filled in',
    (_title, template) => {
      const issues = validateGraph(finishSetup(template.graph), CTX);
      expect(issues).toEqual([]);
    },
  );

  it.each(TEMPLATES.map((t) => [t.title, t] as const))(
    '%s, before setup, only asks for what its card says it needs',
    (_title, template) => {
      const issues = validateGraph(template.graph, CTX).filter((i) => i.severity === 'error');
      const asks = new Set(
        issues.map((issue) => {
          const node = template.graph.nodes.find((n) => n.key === issue.nodeKey);
          if (node?.type === 'notify.slack') return 'slack';
          if (node?.type === 'data.googleSheetsAppendRow') return 'google';
          if (node?.type === 'postgear.createDraft') return 'channel';
          return issue.code;
        }),
      );
      expect([...asks].sort()).toEqual([...template.needs].sort());
    },
  );

  it('Failed Post Alert leaves out posts that only gave up after several tries', () => {
    const filter = getTemplate('failed-post-alert')?.graph.nodes.find(
      (n) => n.type === 'logic.filter',
    );
    expect(filter?.config).toEqual({
      condition: {
        match: 'all',
        rules: [
          {
            id: 'reason',
            left: '{{ trigger.error.reason }}',
            operator: 'isNot',
            right: 'retries_exhausted',
          },
        ],
      },
    });
  });

  it('lists templates without their graphs', () => {
    const [first] = listTemplates();
    expect(first).not.toHaveProperty('graph');
    expect(first).toMatchObject({ id: 'publishing-report', steps: 4, needs: ['google', 'slack'] });
  });
});

describe('instantiateTemplate', () => {
  const template = getTemplate('ai-weekly-post');
  if (!template) throw new Error('missing template');
  const graph = instantiateTemplate(template, keyMaker(), { timeZone: 'Asia/Kolkata' });

  it('gives every step a fresh key and moves the lines to them', () => {
    const keys = graph.nodes.map((node) => node.key);
    expect(keys).toEqual([
      'fresh0001',
      'fresh0002',
      'fresh0003',
      'fresh0004',
      'fresh0005',
      'fresh0006',
    ]);
    expect(automationGraphSchema.safeParse(graph).success).toBe(true);
    expect(graph.edges.map((edge) => edge.id)).toContain('fresh0004:approved->fresh0005');
  });

  it('moves every data chip to the new keys', () => {
    const json = JSON.stringify(graph);
    for (const old of template.graph.nodes) expect(json).not.toContain(`nodes.${old.key}.`);
    const draft = graph.nodes.find((node) => node.type === 'postgear.createDraft');
    expect(tokensIn(String(draft?.config.text)).map((t) => t.path)).toEqual([
      'nodes.fresh0004.output.text',
    ]);
  });

  it('keeps chips working: sample data fills them in', () => {
    const scope = sampleScope(graph);
    const review = graph.nodes.find((node) => node.type === 'logic.manualReview');
    const resolved = resolveConfig(review?.config, scope);
    expect(resolved.missing).toEqual([]);
    expect(resolved.value).toMatchObject({ text: 'Fresh sourdough, every morning.' });
  });

  it('sets the schedule to the time zone it is given', () => {
    expect(graph.nodes[0].config.timeZone).toBe('Asia/Kolkata');
    expect(template.graph.nodes[0].config.timeZone).toBe('UTC');
  });

  it('still validates clean after setup', () => {
    expect(validateGraph(finishSetup(graph), CTX)).toEqual([]);
  });

  it('refuses a key maker that repeats itself', () => {
    expect(() => instantiateTemplate(template, () => 'same')).toThrow(/unusable key/);
  });
});

describe('the activation sentence', () => {
  const sentence = (id: string) => {
    const template = getTemplate(id);
    if (!template) throw new Error(id);
    return describeWorkflow(finishSetup(template.graph), CTX);
  };

  it('Publishing Report says it adds a row and sends a Slack message', () => {
    expect(sentence('publishing-report')).toBe(
      'When a post is published, this workflow will add a row to Social Report 2026 and send a Slack message.',
    );
  });

  it('AI Weekly Post says when it runs and what it saves', () => {
    expect(sentence('ai-weekly-post')).toBe(
      'Every Monday at 09:00 (UTC), this workflow will create a draft and send an in-app notification.',
    );
  });

  it('Failed Post Alert says it messages Slack and PostGear', () => {
    expect(sentence('failed-post-alert')).toBe(
      'When a post fails to publish, this workflow will send a Slack message and send an in-app notification.',
    );
  });

  it('puts posting first and stops after three things', () => {
    const graph = graphOf(
      [
        step('trig', 'trigger.manual'),
        step('mail', 'notify.email', {
          config: { to: ['a@x.com', 'b@x.com'], subject: 's', message: 'm' },
        }),
        step('tell', 'notify.inApp', { config: { title: 't' } }),
        step('hook', 'data.httpRequest', { config: { url: 'https://api.example.com/x' } }),
        step('pub', 'postgear.publish', { config: { channels: ['ch_ig'], text: 'Hi' } }),
        step('slak', 'notify.slack'),
      ],
      [
        line('trig', 'mail'),
        line('mail', 'tell'),
        line('tell', 'hook'),
        line('hook', 'pub'),
        line('pub', 'slak'),
      ],
    );
    expect(describeWorkflow(graph, CTX)).toBe(
      'When you click Run Now, this workflow will publish to Bloom Bakery, email 2 people, send data to api.example.com and 2 more steps.',
    );
  });

  it('says plainly when a workflow has no trigger or does nothing outside itself', () => {
    expect(describeWorkflow(graphOf([]))).toBe('This workflow has no trigger yet.');
    expect(describeWorkflow(graphOf([step('trig', 'trigger.manual')]))).toBe(
      'When you click Run Now, this workflow will not do anything yet.',
    );
    expect(
      describeWorkflow(
        graphOf([step('trig', 'trigger.manual'), step('d', 'logic.delay')], [line('trig', 'd')]),
      ),
    ).toBe('When you click Run Now, this workflow will run 1 step.');
  });
});

describe('riskSummary', () => {
  it('lists outside steps and the AI credits a run can spend', () => {
    const report = riskSummary(getTemplate('publishing-report')?.graph as AutomationGraph);
    expect(report).toMatchObject({
      publishes: [],
      publishesWithoutReview: false,
      aiCreditsPerRun: 0,
    });
    expect(report.external.map((node) => node.key)).toEqual(['sheet', 'slack']);
    expect(
      riskSummary(getTemplate('ai-weekly-post')?.graph as AutomationGraph).aiCreditsPerRun,
    ).toBe(15);
  });

  const publishing = (reviewPort?: 'approved' | 'rejected') =>
    graphOf(
      [
        step('trig', 'trigger.manual'),
        step('write', 'ai.generateText', { config: { prompt: 'x' } }),
        ...(reviewPort ? [step('rev', 'logic.manualReview', { config: { text: 'x' } })] : []),
        step('pub', 'postgear.publish', { config: { channels: ['ch_ig'], text: 'x' } }),
      ],
      reviewPort
        ? [line('trig', 'write'), line('write', 'rev'), line('rev', 'pub', reviewPort)]
        : [line('trig', 'write'), line('write', 'pub')],
    );

  it('flags posting without a review, which needs the extra tick', () => {
    expect(riskSummary(publishing())).toMatchObject({
      publishesWithoutReview: true,
      publishes: [{ key: 'pub', name: 'pub', type: 'postgear.publish' }],
    });
  });

  it('does not flag posting that waits for an approved review', () => {
    expect(riskSummary(publishing('approved')).publishesWithoutReview).toBe(false);
  });

  it('flags posting on the Rejected side of a review', () => {
    expect(riskSummary(publishing('rejected')).publishesWithoutReview).toBe(true);
  });
});
