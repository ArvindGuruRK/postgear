'use client';

/**
 * Edit Pinned Data (blueprint 5.2, n8n's pinned data): the step's test
 * data as written, in a text box. It is checked as you type: text that is
 * not valid data names the line, and the result is compared with the
 * fields the step says it gives (a refusal when it cannot stand in for
 * the result, a note when a field is missing or of another kind). Saving
 * goes through the API, which refuses more than 64 KB.
 */
import type { GraphNode } from '@postgear/automation';
import { Alert, Button, Label, Text, Textarea } from '@postgear/ui';
import { TriangleAlert } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  checkPinnedShape,
  PINNED_NOT_SAVED_YET,
  PINNED_TOO_LARGE,
  parsePinnedText,
} from './panel-view-model';

export function pinErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'pinned_too_large') return PINNED_TOO_LARGE;
    if (cause.status === 404) return PINNED_NOT_SAVED_YET;
    if (cause.status !== 0) return cause.message;
  }
  return 'The data was not pinned. Check your connection and try again.';
}

export function PinnedDataEditor({
  node,
  initialText,
  onSave,
  onCancel,
}: {
  node: Pick<GraphNode, 'key' | 'type' | 'typeVersion' | 'config' | 'name'>;
  initialText: string;
  /** Resolves once the API has the data; throws to show its refusal. */
  onSave: (output: unknown) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const parsed = useMemo(() => parsePinnedText(text), [text]);
  const shape = useMemo(
    () => (parsed.ok ? checkPinnedShape(node, parsed.value) : { error: null, warnings: [] }),
    [node, parsed],
  );
  const problem = parsed.ok ? shape.error : parsed.message;

  async function save() {
    if (!parsed.ok || shape.error) return;
    setSaving(true);
    setRefusal(null);
    try {
      await onSave(parsed.value);
    } catch (cause) {
      setRefusal(pinErrorMessage(cause));
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="pinned-data-editor">
      <Label htmlFor={`${id}-text`}>Pinned data for {node.name}</Label>
      <Textarea
        id={`${id}-text`}
        value={text}
        spellCheck={false}
        rows={12}
        variant={problem ? 'error' : 'default'}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-problem` : undefined}
        placeholder="Enter your test data"
        onChange={(event) => {
          setText(event.target.value);
          setRefusal(null);
        }}
        onKeyDown={(event) => {
          // Tab types two spaces, as in any code box; Shift+Tab still leaves.
          if (event.key === 'Tab' && !event.shiftKey) {
            event.preventDefault();
            const box = event.currentTarget;
            const { selectionStart, selectionEnd } = box;
            const next = `${text.slice(0, selectionStart)}  ${text.slice(selectionEnd)}`;
            setText(next);
            requestAnimationFrame(() =>
              box.setSelectionRange(selectionStart + 2, selectionStart + 2),
            );
          }
        }}
        className="min-h-48 flex-1 text-xs"
      />
      {problem ? (
        <Text id={`${id}-problem`} size="sm" className="text-dangerInk" role="alert">
          {problem}
        </Text>
      ) : null}
      {shape.warnings.map((warning) => (
        <Text key={warning} size="sm" muted>
          {warning}
        </Text>
      ))}
      {refusal ? (
        <Alert variant="danger" className="items-center">
          <TriangleAlert aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={2.5} />
          <span>{refusal}</span>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={saving || problem !== null}>
          {saving ? 'Saving...' : 'Save Pinned Data'}
        </Button>
      </div>
    </div>
  );
}
