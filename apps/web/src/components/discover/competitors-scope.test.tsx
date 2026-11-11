/**
 * The Competitors tab and the workspace switch (Module 09's review): the list
 * is scoped by the workspace cookie, so a tab reached by address while the
 * cookie still names another workspace asks for nothing until the switch has
 * landed, and says so when the switch is refused.
 */
import '@testing-library/jest-dom';
import { TooltipProvider } from '@postgear/ui';
import { act, render, screen, waitFor } from '@testing-library/react';
import { getCompetitors } from '@/lib/discover-api';
import { createWorkspaceScope, type WorkspaceScope } from '../navigation/workspace-provider';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { COMPETITORS_LOAD_FAILED, CompetitorsTab, NO_COMPETITORS_TITLE } from './competitors-tab';

let scope: WorkspaceScope;

jest.mock('../navigation/workspace-provider', () => {
  const actual = jest.requireActual('../navigation/workspace-provider');
  return { ...actual, useOptionalWorkspace: () => ({ activeOrgId: 'org-a', scope }) };
});

jest.mock('@/lib/discover-api', () => ({
  getCompetitors: jest.fn(),
  getCompetitorItems: jest.fn(),
  createCompetitor: jest.fn(),
  updateCompetitor: jest.fn(),
  removeCompetitor: jest.fn(),
  findCompetitorFeeds: jest.fn(),
}));

const mockedList = getCompetitors as jest.MockedFunction<typeof getCompetitors>;

beforeAll(stubBrowserLayout);

beforeEach(() => {
  scope = createWorkspaceScope();
  mockedList.mockReset();
  mockedList.mockResolvedValue({ competitors: [], limit: 20 });
});

function tab() {
  return (
    <TooltipProvider>
      <CompetitorsTab orgId="org-a" isAdmin now={new Date('2026-11-10T12:00:00Z')} refreshKey={0} />
    </TooltipProvider>
  );
}

describe('CompetitorsTab, while the workspace is being switched', () => {
  it('asks for the list at once when no switch is in flight', async () => {
    render(tab());

    expect(await screen.findByText(NO_COMPETITORS_TITLE)).toBeInTheDocument();
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  it('asks for nothing until the switch has landed, then asks once', async () => {
    scope.begin('org-a');
    render(tab());

    expect(mockedList).not.toHaveBeenCalled();
    expect(screen.queryByText(NO_COMPETITORS_TITLE)).not.toBeInTheDocument();

    act(() => scope.settle('org-a', true));

    expect(await screen.findByText(NO_COMPETITORS_TITLE)).toBeInTheDocument();
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  it('says the list could not be loaded when the switch is refused, and asks for nothing', async () => {
    scope.begin('org-a');
    render(tab());

    act(() => scope.settle('org-a', false));

    await waitFor(() => expect(screen.getByText(COMPETITORS_LOAD_FAILED)).toBeInTheDocument());
    expect(mockedList).not.toHaveBeenCalled();
  });
});
