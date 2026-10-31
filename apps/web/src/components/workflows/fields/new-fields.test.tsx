/**
 * The step form's Module 10 to 13 controls on real steps: channels for one
 * platform, message previews, the AI cost line, the webhook link's
 * shown-once secret, and the platform settings that hide when a platform
 * has none.
 */
import {
  type AutomationGraph,
  type FormTab,
  type GraphNode,
  getDefinition,
  getTemplate,
  instantiateTemplate,
  type NodeDefinition,
  sampleScope,
} from '@postgear/automation';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { createWebhookSecret, getWebhook } from '@/lib/workflows-api';
import type { Channel } from '@/types/channel';
import { usesAiCredits } from '../panel/test-tab';
import type { FieldContext } from './contract';
import { SchemaForm } from './schema-form';
import { stubBrowserLayout } from './test-dom';
import { channelsForPlatform } from './workspace-fields';

beforeAll(stubBrowserLayout);

jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code?: string,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    connectionOAuthUrl: jest.fn(() => '/oauth'),
    api: jest.fn((path: string) =>
      Promise.resolve(
        path === '/ai/credits'
          ? { credits: { remaining: 240, total: 500, used: 260 } }
          : { tags: [] },
      ),
    ),
  };
});

jest.mock('@/lib/workflows-api', () => ({
  ...jest.requireActual('@/lib/workflows-api'),
  getWebhook: jest.fn(),
  createWebhookSecret: jest.fn(),
}));

const mockedGetWebhook = getWebhook as jest.MockedFunction<typeof getWebhook>;
const mockedCreateSecret = createWebhookSecret as jest.MockedFunction<typeof createWebhookSecret>;

function channel(id: string, providerIdentifier: string, name: string): Channel {
  return {
    id,
    providerIdentifier,
    providerName: providerIdentifier,
    name,
    profile: null,
    picture: null,
    health: 'connected',
    disabled: false,
    refreshNeeded: false,
    inBetweenSteps: false,
    tokenExpiration: null,
    postingTimes: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    color: 0,
  };
}

const CHANNELS = [
  channel('li', 'linkedin', 'Ada Profile'),
  channel('lip', 'linkedin-page', 'Ada Page'),
  channel('x', 'x', 'Ada On X'),
];

let n = 0;
const base = instantiateTemplate(
  getTemplate('publishing-report') as NonNullable<ReturnType<typeof getTemplate>>,
  () => `k${(n++).toString().padStart(9, '0')}`,
) as AutomationGraph;

function renderStep(
  type: string,
  options: {
    config?: Record<string, unknown>;
    tab?: FormTab;
    context?: Partial<FieldContext>;
  } = {},
) {
  const definition = getDefinition(type) as NodeDefinition;
  const node: GraphNode = {
    key: 'ktest00001',
    type,
    typeVersion: definition.typeVersion,
    name: definition.title,
    position: { x: 0, y: 400 },
    config:
      options.config ??
      (JSON.parse(JSON.stringify(definition.defaultConfig)) as Record<string, unknown>),
  };
  const graph: AutomationGraph = {
    ...base,
    nodes: [...base.nodes, node],
    edges: [...base.edges, { ...base.edges[0], id: 'e-test', target: node.key }],
  };
  const context: FieldContext = {
    orgId: 'org1',
    automationId: 'auto1',
    connections: [],
    channels: CHANNELS,
    canManage: true,
    scope: sampleScope(graph),
    scopeSource: {},
    timeZone: 'UTC',
    workflowName: 'Publishing Report',
    ...options.context,
  };
  const onChange = jest.fn();
  function Host() {
    const [config, setConfig] = useState(node.config);
    const current = { ...node, config };
    return (
      <SchemaForm
        definition={definition}
        node={current}
        graph={{ ...graph, nodes: graph.nodes.map((e) => (e.key === node.key ? current : e)) }}
        tab={options.tab ?? 'configure'}
        issues={[]}
        context={context}
        onChange={(path, value) => {
          onChange(path, value);
          setConfig((was) => ({ ...was, [path]: value }));
        }}
      />
    );
  }
  return { ...render(<Host />), onChange };
}

const publishConfig = (provider: string) => ({
  provider,
  channels: [],
  text: '',
  media: '',
  mediaIds: [],
});

describe('channels for one platform', () => {
  it('lets LinkedIn take both profiles and Pages, and nothing else', () => {
    expect(channelsForPlatform(CHANNELS, 'linkedin').map((c) => c.id)).toEqual(['li', 'lip']);
    expect(channelsForPlatform(CHANNELS, 'x').map((c) => c.id)).toEqual(['x']);
  });

  it('keeps a channel already picked even when it is from another platform', () => {
    expect(channelsForPlatform(CHANNELS, 'x', ['li']).map((c) => c.id)).toEqual(['li', 'x']);
  });

  it('shows only that platform in Publish To LinkedIn', () => {
    renderStep('postgear.publish', { config: publishConfig('linkedin'), tab: 'setup' });
    expect(screen.getByText('Ada Profile')).not.toBeNull();
    expect(screen.getByText('Ada Page')).not.toBeNull();
    expect(screen.queryByText('Ada On X')).toBeNull();
  });

  it('points to the Channels page when the platform has no channel', () => {
    renderStep('postgear.publish', { config: publishConfig('youtube'), tab: 'setup' });
    expect(screen.getByText(/No YouTube channel is connected/)).not.toBeNull();
    const link = screen.getByRole('link', { name: /Connect A Channel/ });
    expect(link.getAttribute('href')).toBe('/org1/channels');
  });
});

describe('platform settings', () => {
  it('hides the whole field for a platform without settings', () => {
    const { container } = renderStep('postgear.publish', { config: publishConfig('linkedin') });
    expect(container.querySelector('[data-field-path="settings"]')).toBeNull();
  });

  it('shows the platform settings for YouTube', () => {
    const { container } = renderStep('postgear.publish', { config: publishConfig('youtube') });
    expect(container.querySelector('[data-field-path="settings"]')).not.toBeNull();
  });
});

describe('message previews', () => {
  it('shows markup from the data as plain text, with no link for a non-web address', () => {
    renderStep('notify.slack', {
      config: {
        connectionId: '',
        message: '<script>window.hacked = true</script> <a href="x">hi</a>',
        includeLink: 'javascript:alert(1)',
        footer: true,
      },
    });
    const preview = screen.getByTestId('message-preview');
    expect(preview.textContent).toContain('<script>window.hacked = true</script>');
    expect(preview.querySelector('script')).toBeNull();
    expect(preview.querySelector('a')).toBeNull();
    expect(preview.textContent).not.toContain('Open In PostGear');
    expect(preview.textContent).toContain('Sent by the workflow Publishing Report');
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined();
  });

  it('counts Discord characters and turns red near the limit', () => {
    renderStep('notify.discord', { config: { connectionId: '', message: 'a'.repeat(1_900) } });
    const count = screen.getByTestId('discord-count');
    expect(count.textContent).toContain('1,900 / 2,000');
    expect(count.className).toContain('text-dangerInk');
  });
});

describe('AI cost line', () => {
  it('says what a run costs and what is left this month', async () => {
    renderStep('ai.generateText');
    await waitFor(() =>
      expect(screen.getByTestId('ai-cost-line').textContent).toMatch(
        /^Uses about \d+ AI credits? per run\. You have 240 left this month\.$/,
      ),
    );
  });

  it('marks AI steps as using credits in tests', () => {
    expect(usesAiCredits({ type: 'ai.generateText', typeVersion: 1 })).toBe(true);
    expect(usesAiCredits({ type: 'notify.slack', typeVersion: 1 })).toBe(false);
  });
});

describe('webhook link', () => {
  beforeEach(() => {
    mockedGetWebhook.mockResolvedValue({
      url: 'https://api.example.com/hooks/abc',
      secret: null,
      sample: null,
      sampleAt: null,
    });
    mockedCreateSecret.mockResolvedValue({
      secret: 'whsec_plain_secret_a9F2',
      last4: 'a9F2',
      url: 'https://api.example.com/hooks/abc',
    });
  });

  it('shows a new secret once, and only its last 4 characters after the field opens again', async () => {
    const first = renderStep('trigger.webhook');
    await screen.findByDisplayValue('https://api.example.com/hooks/abc');
    expect(screen.getByText(/curl -X POST/).textContent).toContain('<your secret>');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Secret/ }));
    });
    expect(screen.getByTestId('webhook-secret-once').textContent).toContain(
      'Copy it now. It will not be shown again.',
    );
    expect(screen.getByDisplayValue('whsec_plain_secret_a9F2')).not.toBeNull();
    expect(screen.getByText(/curl -X POST/).textContent).not.toContain('whsec_plain_secret_a9F2');
    expect(first.onChange).not.toHaveBeenCalled();
    first.unmount();

    mockedGetWebhook.mockResolvedValue({
      url: 'https://api.example.com/hooks/abc',
      secret: { last4: 'a9F2', createdAt: '2026-10-31T10:00:00.000Z' },
      sample: null,
      sampleAt: null,
    });
    renderStep('trigger.webhook');
    expect((await screen.findByTestId('webhook-secret-masked')).textContent).toContain('...a9F2');
    expect(screen.queryByDisplayValue('whsec_plain_secret_a9F2')).toBeNull();
    expect(screen.getByRole('button', { name: /Regenerate Secret/ })).not.toBeNull();
  });

  it('tells members to ask an admin', async () => {
    renderStep('trigger.webhook', { context: { canManage: false } });
    expect(await screen.findByText('Ask a workspace admin to create the secret.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Create Secret/ })).toBeNull();
  });
});
