import {
  type AutomationGraph,
  availableData,
  getTemplate,
  instantiateTemplate,
} from '@postgear/automation';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { buildScope, receivedWebhookData } from '../panel/panel-view-model';
import { DATA_DRAG_MIME } from './contract';
import { filterGroups, InsertDataList, NOTHING_UPSTREAM, withSampleFields } from './insert-data';
import { stubBrowserLayout } from './test-dom';

beforeAll(stubBrowserLayout);

function makeGraph(): AutomationGraph {
  let n = 0;
  return instantiateTemplate(
    getTemplate('publishing-report') as NonNullable<ReturnType<typeof getTemplate>>,
    () => `k${(n++).toString().padStart(9, '0')}`,
  );
}

const graph = makeGraph();
const byType = (type: string) =>
  graph.nodes.find((node) => node.type === type) as AutomationGraph['nodes'][number];
const trigger = graph.nodes[0];
const fields = byType('logic.setFields');
const sheet = byType('data.googleSheetsAppendRow');
const slack = byType('notify.slack');

function groupNames(): string[] {
  return screen.getAllByRole('region').map((section) => section.getAttribute('aria-label') ?? '');
}

describe('InsertDataList', () => {
  it('lists only the steps that run before this one, then the run and the workspace', () => {
    render(<InsertDataList graph={graph} nodeKey={sheet.key} onPick={() => undefined} />);
    const names = groupNames();
    expect(names[0]).toBe(trigger.name);
    expect(names).toContain(fields.name);
    expect(names).not.toContain(sheet.name);
    expect(names).not.toContain(slack.name);
    expect(names.slice(-2)).toEqual(['Run', 'Workspace']);
  });

  it('says how to get data when nothing runs before the step', () => {
    render(<InsertDataList graph={graph} nodeKey={trigger.key} onPick={() => undefined} />);
    expect(screen.getByText(NOTHING_UPSTREAM)).not.toBeNull();
    expect(groupNames()).not.toContain(trigger.name);
  });

  it('picks a field by its token path and lets it be dragged', () => {
    const onPick = jest.fn();
    render(<InsertDataList graph={graph} nodeKey={slack.key} onPick={onPick} />);
    const group = screen.getByRole('region', { name: fields.name });
    const row = within(group).getByRole('button', { name: /channel/i });
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith(`nodes.${fields.key}.output.channel`);

    const setData = jest.fn();
    fireEvent.dragStart(row, { dataTransfer: { setData, effectAllowed: 'none' } });
    expect(setData).toHaveBeenCalledWith(DATA_DRAG_MIME, `nodes.${fields.key}.output.channel`);
  });

  it('opens nested fields and searches labels and samples', () => {
    const onPick = jest.fn();
    render(<InsertDataList graph={graph} nodeKey={slack.key} onPick={onPick} />);
    const triggerGroup = screen.getByRole('region', { name: trigger.name });
    expect(within(triggerGroup).queryByRole('button', { name: /Post Link/ })).toBeNull();
    const post = within(triggerGroup).getByRole('button', { name: /^Group of fields Post/ });
    expect(post.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(post);
    expect(within(triggerGroup).getByRole('button', { name: /Post Link/ })).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Search data'), { target: { value: 'post link' } });
    expect(groupNames()).toEqual([trigger.name]);
    fireEvent.change(screen.getByLabelText('Search data'), { target: { value: 'zzzz nothing' } });
    expect(screen.getByText('No data matches your search.')).not.toBeNull();
  });

  it('greys a turned-off step and says so', () => {
    const off: AutomationGraph = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.key === fields.key ? { ...node, disabled: true } : node,
      ),
    };
    render(<InsertDataList graph={off} nodeKey={slack.key} onPick={() => undefined} />);
    const group = screen.getByRole('region', { name: fields.name });
    expect(group.className).toContain('opacity-50');
    expect(within(group).getByText('This step is turned off.')).not.toBeNull();
  });

  it('keeps a group whose title matches the search whole', () => {
    const groups = [
      {
        source: 'trigger',
        nodeKey: 'a',
        title: 'Post Published',
        icon: 'zap',
        fields: [{ path: 'trigger.x', label: 'X', type: 'text' as const, children: [] }],
      },
    ];
    expect(filterGroups(groups as never, 'published')).toHaveLength(1);
    expect(filterGroups(groups as never, 'nope')).toHaveLength(0);
  });

  it('offers the fields of the data a Webhook trigger last received (Module 13)', () => {
    const blog = instantiateTemplate(
      getTemplate('blog-to-draft') as NonNullable<ReturnType<typeof getTemplate>>,
      (key) => key,
    );
    const received = receivedWebhookData({
      sample: { headline: 'Spring menu', author: { name: 'Mia' }, 'not a key': 1 },
      sampleAt: '2026-11-03T09:00:00Z',
    });
    const { scope } = buildScope(blog, [], undefined, {}, received);
    const onPick = jest.fn();
    render(<InsertDataList graph={blog} nodeKey="write" scope={scope} onPick={onPick} />);
    const group = screen.getByRole('region', { name: 'New Blog Article' });
    fireEvent.click(within(group).getByRole('button', { name: /^Group of fields Received Data/ }));

    fireEvent.click(within(group).getByRole('button', { name: /Headline Spring menu/ }));
    expect(onPick).toHaveBeenLastCalledWith('trigger.body.headline');
    fireEvent.click(within(group).getByRole('button', { name: /All Received Data/ }));
    expect(onPick).toHaveBeenLastCalledWith('trigger.body');
    // A key a token cannot hold is left out; the built-in sample's fields are gone.
    expect(within(group).queryByRole('button', { name: /Not A Key/ })).toBeNull();
    expect(within(group).queryByRole('button', { name: /^Text Title/ })).toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: /^Group of fields Author/ }));
    fireEvent.click(within(group).getByRole('button', { name: /Name Mia/ }));
    expect(onPick).toHaveBeenLastCalledWith('trigger.body.author.name');
  });

  it('leaves groups of fields with fields of their own, and other steps, alone', () => {
    const groups = availableData(graph, slack.key);
    expect(withSampleFields(groups)).toEqual(groups);
  });
});
