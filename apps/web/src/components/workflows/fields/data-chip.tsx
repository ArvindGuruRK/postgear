'use client';

/**
 * One data chip inside a chip input (blueprint 5.3): the source step's icon
 * tile and "Post Published: Post Link". Hovering or clicking it opens its
 * card: the sample value (labelled with where it came from), the source
 * step, and the Format menu. A chip whose data is gone, or that a
 * validation issue names, turns red with the reason.
 */
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import {
  type AutomationGraph,
  formatToken,
  type RunScope,
  type TokenFilter,
  type ValidationIssue,
} from '@postgear/automation';
import { Button, cn, MotionIcon, Popover, PopoverAnchor, PopoverContent, Text } from '@postgear/ui';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { SlidersHorizontal } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppIcon } from '../app-icon';
import { chipInfo, chipName, chipValue, previewText } from './chip-model';
import type { FieldContext } from './contract';
import { sourceOfPath, sourceWords } from './field-env';
import { FormatMenu } from './format-menu';

/** What a chip needs from the field it sits in. */
export interface ChipFieldValue {
  graph?: AutomationGraph;
  nodeKey?: string;
  /** The config path of the field, to match issues. */
  fieldPath: string;
  issues: readonly ValidationIssue[];
  scope?: RunScope;
  scopeSource?: FieldContext['scopeSource'];
  timeZone?: string;
}

export const ChipFieldContext = createContext<ChipFieldValue | null>(null);

const OPEN_DELAY = 350;
const CLOSE_DELAY = 200;

/** The chip's error issue: a `token.*` error on this field naming this chip's text. */
export function chipIssue(
  issues: readonly ValidationIssue[],
  fieldPath: string,
  raw: string,
): ValidationIssue | undefined {
  return issues.find(
    (issue) =>
      issue.severity === 'error' &&
      issue.code.startsWith('token.') &&
      issue.field === fieldPath &&
      issue.token === raw,
  );
}

export function DataChipView({
  node,
  updateAttributes,
  deleteNode,
  selected,
  editor,
}: ReactNodeViewProps) {
  const field = useContext(ChipFieldContext);
  const path = String(node.attrs.path ?? '');
  const raw = String(node.attrs.raw ?? '');
  const filters: TokenFilter[] = Array.isArray(node.attrs.filters) ? node.attrs.filters : [];

  const info = field?.graph
    ? chipInfo(field.graph, field.nodeKey, path)
    : {
        source: 'Data',
        field: path,
        icon: 'manual',
        available: true as boolean,
        problem: undefined,
      };
  const issue = field ? chipIssue(field.issues, field.fieldPath, raw) : undefined;
  const broken = !info.available || issue !== undefined;
  const problem = info.problem ?? (issue ? issue.message : undefined);
  const name = chipName(info);

  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const pin = () => {
    clear();
    pinned.current = true;
    setOpen(true);
  };

  const hoverOpen = () => {
    clear();
    timer.current = setTimeout(() => setOpen(true), OPEN_DELAY);
  };
  const hoverClose = () => {
    clear();
    timer.current = setTimeout(() => {
      if (!pinned.current) setOpen(false);
    }, CLOSE_DELAY);
  };

  const before = field?.scope ? chipValue(path, [], field.scope, field.timeZone) : undefined;
  const sample = field?.scope ? chipValue(path, filters, field.scope, field.timeZone) : undefined;
  const sourceLabel = sourceWords(
    field?.graph ? sourceOfPath(field.graph, field.scopeSource, path) : undefined,
  );
  const editable = editor.isEditable;

  return (
    <NodeViewWrapper as="span" className="inline">
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!next) pinned.current = false;
          setOpen(next);
        }}
      >
        <PopoverAnchor asChild>
          {/* biome-ignore lint/a11y/useSemanticElements: an atom inside an editable area; a real <button> would take the caret's place in the text */}
          <span
            role="button"
            tabIndex={-1}
            contentEditable={false}
            aria-label={name}
            title={broken ? problem : undefined}
            data-chip-state={broken ? 'broken' : 'ok'}
            data-chip-path={path}
            onMouseEnter={hoverOpen}
            onMouseLeave={hoverClose}
            onClick={pin}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                pin();
              }
            }}
            className={cn(
              'mx-0.5 inline-flex max-w-full cursor-pointer select-none items-center gap-1 rounded-md border-2 px-1 py-px align-middle',
              'type-label text-xs leading-5',
              broken
                ? 'border-actionDanger bg-actionDanger text-onActionLight'
                : 'border-outline bg-secondary text-ink',
              selected && 'outline-solid outline-[3px] outline-offset-1 outline-focusRing',
            )}
          >
            <span
              aria-hidden="true"
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-outline bg-secondary"
            >
              <AppIcon icon={info.icon} className="h-3 w-3" />
            </span>
            <span className="truncate">
              {info.source}: {info.field}
            </span>
            {filters.length > 0 ? (
              <SlidersHorizontal aria-hidden="true" className="h-3 w-3 shrink-0" strokeWidth={3} />
            ) : null}
          </span>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="flex w-80 flex-col gap-3 p-3"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onMouseEnter={clear}
          onMouseLeave={hoverClose}
          onFocusCapture={() => {
            pinned.current = true;
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-secondary">
              <AppIcon icon={info.icon} className="h-4 w-4" />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate type-ui text-sm text-ink">{info.field}</span>
              <Text size="xs" muted>
                From {info.source}
              </Text>
            </div>
          </div>

          {broken ? (
            <Text size="sm" className="text-dangerInk">
              {problem ?? 'This data is no longer available.'}
            </Text>
          ) : null}

          {sample !== undefined || before !== undefined ? (
            <div className="flex flex-col gap-1 rounded-md border-2 border-outline bg-inset p-2">
              <span className="type-label text-xs text-ink">{sourceLabel}</span>
              <span className="break-words font-sans text-sm text-ink">
                {previewText(sample, 160)}
              </span>
            </div>
          ) : null}

          {editable ? (
            <>
              <FormatMenu
                filters={filters}
                value={before}
                timeZone={field?.timeZone}
                onChange={(next) =>
                  updateAttributes({ filters: next, raw: formatToken({ path, filters: next }) })
                }
              />
              <div>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setOpen(false);
                    deleteNode();
                  }}
                >
                  <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
                  Remove Data
                </Button>
              </div>
            </>
          ) : null}
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
}
