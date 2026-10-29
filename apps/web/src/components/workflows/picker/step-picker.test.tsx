import { NODE_CATALOG } from '@postgear/automation';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CatalogEntry, WorkspaceCatalog } from '@/types/workflows';
import { StepPicker } from './step-picker';

const CATALOG: WorkspaceCatalog = {
  steps: NODE_CATALOG.map(
    (def): CatalogEntry => ({
      type: def.type,
      typeVersion: def.typeVersion,
      category: def.category,
      title: def.title,
      description: def.description,
      keywords: def.keywords,
      icon: def.icon,
      family: def.family,
      priority: def.priority,
      sideEffect: def.sideEffect,
      publishes: def.publishes ?? false,
      connection: def.connection ?? null,
      credits: 0,
      state: def.status === 'comingSoon' ? 'comingSoon' : 'ready',
      runnable: true,
      reason: def.status === 'comingSoon' ? (def.comingSoonReason ?? null) : null,
    }),
  ),
  connectedPlatforms: [],
};

beforeAll(() => {
  // jsdom has no matchMedia; the animated buttons ask it about reduced motion.
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
});

function renderPicker() {
  const onPick = jest.fn();
  render(
    <StepPicker
      placement="next"
      catalog={CATALOG}
      hasTrigger
      recent={[]}
      orgId="org-1"
      onPick={onPick}
      autoFocus
    />,
  );
  return { onPick, search: screen.getByRole('combobox', { name: 'Search steps' }) };
}

describe('StepPicker', () => {
  it('moves through the rows with the arrow keys and opens a category with Enter', () => {
    const { search } = renderPicker();
    const options = () => screen.getAllByRole('option');
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    expect(search.getAttribute('aria-activedescendant')).toBe(options()[1].id);
    const category = options()[1].textContent ?? '';
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      category.replace(/\d+$/, '').trim(),
    );
  });

  it('adds the highlighted step with Enter', () => {
    const { search, onPick } = renderPicker();
    fireEvent.change(search, { target: { value: 'slack' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ type: 'notify.slack' }));
  });

  it('shows Coming Soon steps without letting them be added', () => {
    const { search, onPick } = renderPicker();
    fireEvent.change(search, { target: { value: 'whatsapp' } });
    const option = screen.getByRole('option', { name: /WhatsApp/ });
    expect(option.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(option);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onPick).not.toHaveBeenCalled();
  });
});
