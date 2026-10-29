'use client';

/**
 * Workflow Builder pieces (Sprint 10) that are checked here before the
 * step panel uses them: the connection picker in its three states.
 */
import { useState } from 'react';
import { ConnectionPicker } from '@/components/workflows/connection-picker';
import type { Connection } from '@/types/workflows';
import { Row, Section } from '../shared';

const DEMO_CONNECTIONS: Connection[] = [
  {
    id: 'demo-slack-1',
    provider: 'slack',
    name: 'Marketing Slack',
    status: 'CONNECTED',
    maskedHint: 'hooks.slack.com/...a9F2',
    meta: null,
    lastCheckedAt: null,
    lastError: null,
    createdAt: '2026-10-29T00:00:00.000Z',
    updatedAt: '2026-10-29T00:00:00.000Z',
    usedBy: [],
  },
  {
    id: 'demo-slack-2',
    provider: 'slack',
    name: 'Support Slack',
    status: 'NEEDS_RECONNECT',
    maskedHint: 'hooks.slack.com/...77Qe',
    meta: null,
    lastCheckedAt: '2026-10-28T09:30:00.000Z',
    lastError: 'Slack refused the link. Reconnect it in Connections.',
    createdAt: '2026-10-29T00:00:00.000Z',
    updatedAt: '2026-10-29T00:00:00.000Z',
    usedBy: [],
  },
];

const NONE: Connection[] = [];

export function WorkflowsSection() {
  const [value, setValue] = useState('demo-slack-1');
  const returnTo = '/seed-demo-org/workflows/demo?step=slack&tab=setup';

  return (
    <Section
      title="Workflows"
      description="The connection picker the step panel uses: it writes only the chosen id."
    >
      <Row label="Has connections">
        <div className="w-80">
          <ConnectionPicker
            kind="slack"
            value={value}
            onChange={setValue}
            returnTo={returnTo}
            connections={DEMO_CONNECTIONS}
            canManage
          />
        </div>
      </Row>
      <Row label="None, as an admin">
        <div className="w-80">
          <ConnectionPicker
            kind="discord"
            value=""
            onChange={() => undefined}
            returnTo={returnTo}
            connections={NONE}
            canManage
          />
        </div>
      </Row>
      <Row label="None, as a member">
        <div className="w-80">
          <ConnectionPicker
            kind="teams"
            value=""
            onChange={() => undefined}
            returnTo={returnTo}
            connections={NONE}
            canManage={false}
          />
        </div>
      </Row>
    </Section>
  );
}
