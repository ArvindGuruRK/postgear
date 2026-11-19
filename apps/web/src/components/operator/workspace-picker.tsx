'use client';

/**
 * The workspace an operator works on in Workspace Overrides and Usage: a
 * search by name, id or an admin's address, a short result list, and the
 * chosen workspace's facts. The choice is shared by both tabs, and it is the
 * path's id on every call: the org cookie is never involved.
 */
import { Badge, Button, cn, SearchInput, Spinner } from '@postgear/ui';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { WorkspaceSummary } from '@/types/operator';
import { errorSentence } from './operator-fields';
import { OPERATOR_COPY, shortDate, tierName } from './operator-model';

const SEARCH_DELAY_MS = 250;

export function WorkspacePicker({
  selected,
  onSelect,
}: {
  selected: WorkspaceSummary | null;
  onSelect: (workspace: WorkspaceSummary | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WorkspaceSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    if (selected) return;
    const call = ++latest.current;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const q = query.trim();
        const answer = await api<{ workspaces: WorkspaceSummary[] }>(
          `/operator/workspaces${q ? `?q=${encodeURIComponent(q)}` : ''}`,
        );
        if (call === latest.current) {
          setResults(answer.workspaces);
          setError(null);
        }
      } catch (caught) {
        if (call === latest.current) setError(errorSentence(caught));
      } finally {
        if (call === latest.current) setSearching(false);
      }
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query, selected]);

  if (selected) {
    return (
      <div
        className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border-2 border-outline bg-chrome px-4 py-3 shadow-surfaceSm"
        data-testid="operator-workspace"
      >
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-sans text-base font-semibold text-ink">
            {selected.name}
          </span>
          <span className="truncate font-mono text-xs text-ink type-muted">{selected.id}</span>
        </div>
        <Fact label="Plan" value={tierName(selected.tier)} />
        <Fact label="Status" value={statusName(selected.status)} />
        <Fact label="Admin" value={selected.adminEmail ?? 'None'} />
        <Fact label="Members" value={String(selected.members)} />
        <Fact label="Created" value={shortDate(selected.createdAt)} />
        <Button variant="secondary" size="sm" className="ms-auto" onClick={() => onSelect(null)}>
          Change Workspace
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <SearchInput
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery('')}
        placeholder={OPERATOR_COPY.searchPlaceholder}
        aria-label="Search workspaces"
        className="max-w-xl"
      />
      {error ? <p className="m-0 font-sans text-sm text-dangerInk">{error}</p> : null}
      {results === null && searching ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : results && results.length === 0 ? (
        <p className="m-0 rounded-md border-2 border-outline bg-inset px-4 py-6 text-center font-sans text-sm text-ink">
          {OPERATOR_COPY.noWorkspace}
        </p>
      ) : results ? (
        <ul
          className={cn(
            'm-0 flex list-none flex-col overflow-hidden rounded-md border-2 border-outline bg-inset p-0',
            searching ? 'opacity-60' : null,
          )}
          aria-label="Workspaces"
        >
          {results.map((workspace) => (
            <li key={workspace.id} className="border-b-2 border-outline last:border-b-0">
              <button
                type="button"
                onClick={() => onSelect(workspace)}
                className={cn(
                  'flex w-full items-center gap-4 px-4 py-2.5 text-left outline-none',
                  'hover:bg-secondary focus-visible:bg-secondary',
                  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focusRing',
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-sans text-sm font-semibold text-ink">
                    {workspace.name}
                  </span>
                  <span className="truncate font-sans text-xs text-ink type-muted">
                    {workspace.adminEmail ?? 'No admin'}, {workspace.id}
                  </span>
                </span>
                <Badge variant="outline">{tierName(workspace.tier)}</Badge>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!selected && results && results.length > 0 ? (
        <p className="m-0 font-sans text-xs text-ink type-muted">{OPERATOR_COPY.pickWorkspace}</p>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="font-sans text-xs text-ink type-muted">{label}</span>
      <span className="truncate font-sans text-sm text-ink">{value}</span>
    </div>
  );
}

function statusName(status: string): string {
  const words = status.toLowerCase().split('_');
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}
