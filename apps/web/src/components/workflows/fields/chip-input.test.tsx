import {
  type AutomationGraph,
  getTemplate,
  instantiateTemplate,
  type ValidationIssue,
} from '@postgear/automation';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { ChipInput, opensInsertData } from './chip-input';
import { insertDataAtLastField } from './insert-target';
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
const slack = graph.nodes.find(
  (node) => node.type === 'notify.slack',
) as AutomationGraph['nodes'][number];
const triggerName = graph.nodes[0].name;

function Harness({
  initial,
  onValue,
  issues = [],
  g = graph,
}: {
  initial: string;
  onValue?: (value: string) => void;
  issues?: ValidationIssue[];
  g?: AutomationGraph;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ChipInput
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
      label="Message"
      fieldPath="message"
      multiline
      graph={g}
      nodeKey={slack.key}
      issues={issues}
    />
  );
}

async function textbox() {
  return screen.findByRole('textbox', { name: 'Message' });
}

describe('ChipInput', () => {
  it('shows chips with their source and field, never braces', async () => {
    render(<Harness initial="New post: {{ trigger.post.url }}" />);
    const chip = await screen.findByRole('button', { name: `data: ${triggerName}, Post Link` });
    expect(chip.getAttribute('data-chip-state')).toBe('ok');
    expect((await textbox()).textContent).not.toContain('{{');
  });

  it('turns a chip red when its source step is gone', async () => {
    render(<Harness initial="Hi {{ nodes.gone12345.output.text }}" />);
    const chip = await screen.findByRole('button', { name: 'data: Removed Step, Text' });
    expect(chip.getAttribute('data-chip-state')).toBe('broken');
    expect(chip.getAttribute('title')).toBe('This data is no longer available.');
  });

  it('turns a chip red when validation names it', async () => {
    const token = '{{ trigger.post.url | shout }}';
    render(
      <Harness
        initial={token}
        issues={[
          {
            severity: 'error',
            code: 'token.bad_filter',
            message: 'This format option is not recognised.',
            nodeKey: slack.key,
            field: 'message',
            token,
          },
        ]}
      />,
    );
    const chip = await screen.findByRole('button', { name: `data: ${triggerName}, Post Link` });
    expect(chip.getAttribute('data-chip-state')).toBe('broken');
  });

  it('keeps key presses away from the canvas', async () => {
    const parentKeys = jest.fn();
    const windowKeys = jest.fn();
    window.addEventListener('keydown', windowKeys);
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: a stand-in for the canvas's key handler
      <div onKeyDown={parentKeys}>
        <Harness initial="{{ trigger.post.url }}" />
      </div>,
    );
    const box = await textbox();
    fireEvent.keyDown(box, { key: 'Backspace' });
    fireEvent.keyDown(box, { key: 'Delete' });
    expect(parentKeys).not.toHaveBeenCalled();
    expect(windowKeys).not.toHaveBeenCalled();
    window.removeEventListener('keydown', windowKeys);
  });

  it('removes a whole chip with Backspace', async () => {
    const onValue = jest.fn();
    render(<Harness initial="Link {{ trigger.post.url }}" onValue={onValue} />);
    const box = await textbox();
    await screen.findByRole('button', { name: `data: ${triggerName}, Post Link` });
    // The caret at the end, right after the chip.
    act(() => {
      box.focus();
    });
    const editor = (box as unknown as { editor?: { commands: { focus: (at: string) => void } } })
      .editor;
    act(() => editor?.commands.focus('end'));
    fireEvent.keyDown(box, { key: 'Backspace' });
    await waitFor(() => expect(onValue).toHaveBeenLastCalledWith('Link '));
    expect(screen.queryByRole('button', { name: /^data:/ })).toBeNull();
  });

  it('writes an unchanged value back exactly and a new chip as a token', async () => {
    const onValue = jest.fn();
    const odd = '{{trigger.post.url}}  \\{{ literal }}';
    render(<Harness initial={odd} onValue={onValue} />);
    const box = await textbox();
    act(() => box.focus());
    expect(insertDataAtLastField('run.id')).toBe(true);
    await waitFor(() => expect(onValue).toHaveBeenCalled());
    expect(onValue.mock.lastCall?.[0]).toContain('{{ run.id }}');
    expect(onValue.mock.lastCall?.[0]).toContain('\\{{ literal }}');
  });

  it('inserts from the Insert Data list', async () => {
    const onValue = jest.fn();
    render(<Harness initial="" onValue={onValue} />);
    await textbox();
    fireEvent.click(screen.getByRole('button', { name: 'Insert Data' }));
    fireEvent.change(await screen.findByLabelText('Search data'), {
      target: { value: 'post link' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Post Link/ }));
    await waitFor(() => expect(onValue).toHaveBeenLastCalledWith('{{ trigger.post.url }}'));
  });

  it('opens Insert Data for { always and / only at a word start', () => {
    expect(opensInsertData('a', '{')).toBe(true);
    expect(opensInsertData('', '/')).toBe(true);
    expect(opensInsertData(' ', '/')).toBe(true);
    expect(opensInsertData(':', '/')).toBe(false);
    expect(opensInsertData('a', 'x')).toBe(false);
  });
});
