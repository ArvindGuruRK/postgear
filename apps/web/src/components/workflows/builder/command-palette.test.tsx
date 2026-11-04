import type { GraphNode } from '@postgear/automation';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { stubBrowserLayout } from '../fields/test-dom';
import type { PickerItem } from '../picker/picker-search';
import { CommandPalette } from './command-palette';

beforeAll(() => {
  stubBrowserLayout();
  // A focused button plays its animated icon; the icon stub is a bare <svg> without the handle.
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
  // cmdk scrolls the active row into view; jsdom has no such thing.
  Element.prototype.scrollIntoView = () => undefined;
});

const steps = [
  { key: 's1', name: 'Slack Note', type: 'notify.slack', typeVersion: 1 },
] as unknown as GraphNode[];
const items = [{ id: 'ai.generateText', title: 'Generate Text', icon: 'ai', keywords: [] }] as unknown as PickerItem[];

function renderPalette() {
  const handlers = {
    onOpenChange: jest.fn(),
    onAddStep: jest.fn(),
    onGoToStep: jest.fn(),
    onCommand: jest.fn(),
  };
  render(<CommandPalette open items={items} steps={steps} {...handlers} />);
  return handlers;
}

describe('CommandPalette', () => {
  it('shows commands, steps and steps to add, with the keys to use', () => {
    renderPalette();
    expect(screen.getByRole('option', { name: /Test Workflow/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Slack Note/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Generate Text/ })).toBeTruthy();
    expect(screen.getByText('to run')).toBeTruthy();
  });

  it('narrows to one group from its filter tab', () => {
    renderPalette();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Steps' }));
    expect(screen.getByRole('option', { name: /Slack Note/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Generate Text/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Test Workflow/ })).toBeNull();
  });

  it('runs a command and closes', () => {
    const handlers = renderPalette();
    const listbox = screen.getByRole('listbox');
    fireEvent.click(within(listbox).getByRole('option', { name: /Activate/ }));
    expect(handlers.onOpenChange).toHaveBeenCalledWith(false);
    expect(handlers.onCommand).toHaveBeenCalledWith('activate');
  });

  it('goes to a step and adds a step', () => {
    const handlers = renderPalette();
    fireEvent.click(screen.getByRole('option', { name: /Slack Note/ }));
    expect(handlers.onGoToStep).toHaveBeenCalledWith('s1');
    fireEvent.click(screen.getByRole('option', { name: /Generate Text/ }));
    expect(handlers.onAddStep).toHaveBeenCalledWith(items[0]);
  });
});
