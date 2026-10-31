'use client';

/**
 * Google Sheets: Append Row's three fields (Module 13, blueprint 5.4).
 *
 * - **Spreadsheet** (`kind: 'spreadsheet'`): Pick A Spreadsheet opens
 *   Google's own picker; Create A New Spreadsheet makes one with the step's
 *   column names as its header row. A simulated connection (local testing)
 *   has no picker, so it offers Use A Sample Spreadsheet instead. PostGear
 *   only opens spreadsheets picked here or that it created (`drive.file`).
 * - **Tab** (`kind: 'sheetTab'`): a select of the spreadsheet's tabs.
 * - **Columns** (`kind: 'sheetColumns'`): one row per header with a chip
 *   input. Refresh Columns reads the header row again: columns that left the
 *   sheet turn red, new ones arrive empty. While nothing is typed yet, the
 *   rows follow the tab on their own.
 *
 * The three read the connection from the step's config and share what they
 * loaded through a small cache, so a pick fills the tab list at once.
 */
import { FilePlusIcon } from '@animateicons/react/lucide/file-plus-icon';
import { FileSpreadsheetIcon } from '@animateicons/react/lucide/file-spreadsheet-icon';
import { RefreshCwIcon } from '@animateicons/react/lucide/refresh-cw-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import type { FieldKind, NodeDefinition } from '@postgear/automation';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormErrorMessage,
  FormField,
  FormLabel,
  Input,
  MotionIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
} from '@postgear/ui';
import { FileSpreadsheet, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  createSpreadsheet,
  GOOGLE_ERRORS,
  getPickerToken,
  getSheetHeader,
  getSpreadsheet,
} from '@/lib/workflows-api';
import type { Connection, SheetTabRef, SpreadsheetDetail } from '@/types/workflows';
import { ChipInput } from './chip-input';
import { FIELD_PATH_ATTRIBUTE } from './contract';
import { useFieldEnv } from './field-env';
import { asText, type FieldControlProps, joinPath } from './field-types';
import { getAtPath } from './form-model';
import { PICKER_LOAD_FAILED, pickSpreadsheet } from './google-picker';
import {
  columnsFromHeaders,
  columnsOf,
  headersForNew,
  missingHeaders,
  refreshColumns,
  SAMPLE_HEADERS,
  SAMPLE_SPREADSHEET_NAME,
  sheetOf,
  spreadsheetOf,
} from './sheets-model';

export const NO_HEADER_ROW =
  'This tab has no header row. Add one in Google Sheets, or create a new spreadsheet.';
export const DRIVE_FILE_NOTE =
  'PostGear only opens spreadsheets you pick here or that PostGear created.';

/** A refusal from the Google helpers, in the API's own words when it sent some. */
export function googleErrorWords(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === GOOGLE_ERRORS.down || cause.status >= 500) {
      return 'Google Sheets did not answer. Try again in a minute.';
    }
    return cause.message;
  }
  return 'That did not work. Try again.';
}

export function isSimulatedConnection(connection: Pick<Connection, 'meta'> | undefined): boolean {
  return connection?.meta?.simulated === true;
}

// ---- What the three fields share --------------------------------------------------

const details = new Map<string, Promise<SpreadsheetDetail>>();

function detailKey(connectionId: string, spreadsheetId: string) {
  return `${connectionId}:${spreadsheetId}`;
}

/** The spreadsheet's name, link and tabs, asked for once per page. */
function loadDetail(connectionId: string, spreadsheetId: string): Promise<SpreadsheetDetail> {
  const key = detailKey(connectionId, spreadsheetId);
  let found = details.get(key);
  if (!found) {
    found = getSpreadsheet(connectionId, spreadsheetId);
    details.set(key, found);
    found.catch(() => details.delete(key));
  }
  return found;
}

function rememberDetail(connectionId: string, detail: SpreadsheetDetail) {
  details.set(detailKey(connectionId, detail.spreadsheet.id), Promise.resolve(detail));
}

/** Forgets what was loaded (tests, and Refresh). */
export function forgetSpreadsheets() {
  details.clear();
}

/** The config path of the step's field of `kind` (the form says where the tab and columns live). */
function pathOfKind(definition: NodeDefinition, kind: FieldKind, fallback: string): string {
  const form = definition.form;
  if (!form) return fallback;
  return (
    [...form.tabs.setup, ...form.tabs.configure].find((spec) => spec.kind === kind)?.path ??
    fallback
  );
}

function useSheetsStep(props: FieldControlProps) {
  const env = useFieldEnv();
  const connectionField = props.definition.connection?.field ?? 'connectionId';
  const connectionId = asText(props.config[connectionField]);
  const connection = env?.context.connections.find((entry) => entry.id === connectionId);
  const spreadsheetPath = pathOfKind(props.definition, 'spreadsheet', 'spreadsheet');
  const sheetPath = pathOfKind(props.definition, 'sheetTab', 'sheet');
  const columnsPath = pathOfKind(props.definition, 'sheetColumns', 'columns');
  return {
    connectionId,
    connection,
    simulated: isSimulatedConnection(connection),
    spreadsheet: spreadsheetOf(getAtPath(props.config, spreadsheetPath)),
    sheet: sheetOf(getAtPath(props.config, sheetPath)),
    columns: columnsOf(getAtPath(props.config, columnsPath)),
    spreadsheetPath,
    sheetPath,
    columnsPath,
  };
}

type Loaded<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | {
      status: 'failed';
      message: string;
    };

function useDetail(connectionId: string, spreadsheetId: string | undefined) {
  const [state, setState] = useState<Loaded<SpreadsheetDetail>>({ status: 'idle' });
  useEffect(() => {
    if (!connectionId || !spreadsheetId) {
      setState({ status: 'idle' });
      return;
    }
    let live = true;
    setState({ status: 'loading' });
    loadDetail(connectionId, spreadsheetId)
      .then((value) => {
        if (live) setState({ status: 'ready', value });
      })
      .catch((cause: unknown) => {
        if (live) setState({ status: 'failed', message: googleErrorWords(cause) });
      });
    return () => {
      live = false;
    };
  }, [connectionId, spreadsheetId]);
  return state;
}

function Problem({ children }: { children: string }) {
  return (
    <Alert variant="danger" className="items-center p-3" data-testid="sheets-error">
      <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2.5} />
      <span>{children}</span>
    </Alert>
  );
}

// ---- Spreadsheet ----------------------------------------------------------------------

export function SpreadsheetField(props: FieldControlProps) {
  const { onChange, ids } = props;
  const step = useSheetsStep(props);
  const [busy, setBusy] = useState<null | 'pick' | 'create' | 'sample'>(null);
  const [error, setError] = useState<string | null>(null);
  const [simulatedByApi, setSimulatedByApi] = useState(false);
  const [creating, setCreating] = useState(false);
  const detail = useDetail(step.connectionId, step.spreadsheet?.id);
  const simulated = step.simulated || simulatedByApi;

  // Another connection: what the last one said no longer applies.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets when the connection changes
  useEffect(() => {
    setSimulatedByApi(false);
    setError(null);
  }, [step.connectionId]);

  function choose(
    spreadsheet: { id: string; name: string },
    sheet: SheetTabRef | null,
    made: boolean,
  ) {
    onChange(step.spreadsheetPath, spreadsheet);
    onChange(step.sheetPath, sheet);
    onChange('createdByPostGear', made ? true : undefined);
  }

  async function pick() {
    setBusy('pick');
    setError(null);
    try {
      const token = await getPickerToken(step.connectionId);
      let picked: { id: string } | null;
      try {
        picked = await pickSpreadsheet(token);
      } catch {
        setError(PICKER_LOAD_FAILED);
        return;
      }
      if (!picked) return;
      const found = await getSpreadsheet(step.connectionId, picked.id);
      rememberDetail(step.connectionId, found);
      const keep = found.tabs.find((tab) => tab.id === step.sheet?.id) ?? found.tabs[0] ?? null;
      choose({ id: found.spreadsheet.id, name: found.spreadsheet.name }, keep, false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === GOOGLE_ERRORS.simulated) {
        setSimulatedByApi(true);
        return;
      }
      setError(googleErrorWords(cause));
    } finally {
      setBusy(null);
    }
  }

  async function create(name: string, sample: boolean): Promise<string | null> {
    setBusy(sample ? 'sample' : 'create');
    setError(null);
    try {
      const own = headersForNew(step.columns);
      const headers = own.length > 0 ? own : sample ? [...SAMPLE_HEADERS] : [];
      const made = await createSpreadsheet(step.connectionId, { name, headers });
      rememberDetail(step.connectionId, { spreadsheet: made.spreadsheet, tabs: [made.sheet] });
      choose({ id: made.spreadsheet.id, name: made.spreadsheet.name }, made.sheet, true);
      return null;
    } catch (cause) {
      const words = googleErrorWords(cause);
      setError(words);
      return words;
    } finally {
      setBusy(null);
    }
  }

  if (!step.connectionId) {
    return (
      <Text size="sm" muted id={ids.control}>
        Choose a Google connection first.
      </Text>
    );
  }

  const name =
    detail.status === 'ready' ? detail.value.spreadsheet.name : (step.spreadsheet?.name ?? '');
  const url = detail.status === 'ready' ? detail.value.spreadsheet.url : null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: the spreadsheet and its buttons, named by the field's label
    <div
      role="group"
      aria-labelledby={ids.label}
      aria-describedby={ids.message}
      className="flex flex-col gap-3"
    >
      {step.spreadsheet ? (
        <div className="flex items-center gap-3 rounded-md border-2 border-outline bg-inset p-3">
          <FileSpreadsheet
            aria-hidden="true"
            className="h-5 w-5 shrink-0 text-ink"
            strokeWidth={2.5}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="type-ui truncate text-sm text-ink" data-testid="spreadsheet-name">
              {name || 'Spreadsheet'}
            </span>
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="w-fit font-sans text-xs text-ink underline"
              >
                Open in Google Sheets
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {detail.status === 'failed' ? <Problem>{detail.message}</Problem> : null}
      {error ? <Problem>{error}</Problem> : null}

      <div className="flex flex-wrap gap-2">
        {simulated ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            onClick={() => void create(SAMPLE_SPREADSHEET_NAME, true)}
          >
            <MotionIcon icon={FileSpreadsheetIcon} className="h-4 w-4" />
            {busy === 'sample' ? 'Creating...' : 'Use A Sample Spreadsheet'}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => void pick()}
            >
              <MotionIcon icon={FileSpreadsheetIcon} className="h-4 w-4" />
              {busy === 'pick' ? 'Opening...' : 'Pick A Spreadsheet'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => setCreating(true)}
            >
              <MotionIcon icon={FilePlusIcon} className="h-4 w-4" />
              Create A New Spreadsheet
            </Button>
          </>
        )}
      </div>
      <Text size="xs" muted>
        {simulated
          ? 'This is a simulated Google connection, so a made-up spreadsheet stands in for a real one.'
          : DRIVE_FILE_NOTE}
      </Text>

      <CreateSpreadsheetDialog
        open={creating}
        onOpenChange={setCreating}
        busy={busy === 'create'}
        onCreate={(chosen) => create(chosen, false)}
      />
    </div>
  );
}

function CreateSpreadsheetDialog({
  open,
  onOpenChange,
  busy,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  /** Resolves with the refusal's words, or null when it was made. */
  onCreate: (name: string) => Promise<string | null>;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setProblem(null);
    }
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setProblem('Enter a name for the spreadsheet.');
      return;
    }
    const refused = await onCreate(trimmed.slice(0, 200));
    if (refused) setProblem(refused);
    else onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Create A New Spreadsheet</DialogTitle>
            <DialogDescription>
              PostGear makes it in your Google Drive with this step&apos;s columns as its first row.
            </DialogDescription>
          </DialogHeader>
          <FormField className="py-4">
            <FormLabel htmlFor={`${id}-name`} required>
              Spreadsheet name
            </FormLabel>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={200}
              placeholder="Enter your spreadsheet name"
              variant={problem ? 'error' : 'default'}
              onChange={(event) => setName(event.target.value)}
            />
            {problem ? <FormErrorMessage>{problem}</FormErrorMessage> : null}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Creating...' : 'Create Spreadsheet'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- Tab ----------------------------------------------------------------------------------

export function SheetTabField(props: FieldControlProps) {
  const { spec, onChange, errors, ids } = props;
  const step = useSheetsStep(props);
  const detail = useDetail(step.connectionId, step.spreadsheet?.id);

  if (!step.spreadsheet) {
    return (
      <Text size="sm" muted id={ids.control}>
        Pick a spreadsheet first.
      </Text>
    );
  }
  if (detail.status === 'failed') return <Problem>{detail.message}</Problem>;

  const tabs = detail.status === 'ready' ? detail.value.tabs : step.sheet ? [step.sheet] : [];
  const gone =
    detail.status === 'ready' &&
    step.sheet !== null &&
    !tabs.some((tab) => tab.id === step.sheet?.id);
  const options = gone && step.sheet ? [...tabs, step.sheet] : tabs;

  return (
    <div className="flex flex-col gap-1.5">
      <Select
        value={step.sheet ? String(step.sheet.id) : undefined}
        onValueChange={(next) => {
          const tab = options.find((entry) => String(entry.id) === next);
          if (tab) onChange(spec.path, { id: tab.id, title: tab.title });
        }}
        disabled={detail.status === 'loading' && tabs.length === 0}
      >
        <SelectTrigger
          id={ids.control}
          aria-describedby={ids.message}
          aria-invalid={errors[''] !== undefined || gone || undefined}
          className={errors[''] !== undefined || gone ? 'border-actionDanger' : undefined}
        >
          <SelectValue
            placeholder={detail.status === 'loading' ? 'Loading tabs...' : 'Choose a tab'}
          />
        </SelectTrigger>
        <SelectContent>
          {options.map((tab) => (
            <SelectItem key={tab.id} value={String(tab.id)}>
              {tab.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {gone ? (
        <Text size="xs" className="text-dangerInk">
          This tab is no longer in the spreadsheet. Choose another one.
        </Text>
      ) : null}
    </div>
  );
}

// ---- Columns ----------------------------------------------------------------------------

export function SheetColumnsField(props: FieldControlProps) {
  const { spec, onChange, errors, ids } = props;
  const step = useSheetsStep(props);
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const sheetKey =
    step.connectionId && step.spreadsheet && step.sheet
      ? `${step.connectionId}|${step.spreadsheet.id}|${step.sheet.title}`
      : '';

  async function read(): Promise<string[] | null> {
    if (!step.spreadsheet || !step.sheet) return null;
    setLoading(true);
    setProblem(null);
    try {
      const found = await getSheetHeader(step.connectionId, step.spreadsheet.id, step.sheet.title);
      setHeaders(found);
      return found;
    } catch (cause) {
      setProblem(googleErrorWords(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }

  // A new tab: read its header row; while nothing is typed yet, the rows follow it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `sheetKey` names the tab; reading again for the same tab is Refresh Columns
  useEffect(() => {
    setHeaders(null);
    setNote(null);
    if (!sheetKey) return;
    let live = true;
    void read().then((found) => {
      if (!live || !found) return;
      const untouched = step.columns.every((column) => column.value.trim() === '');
      const same =
        found.length === step.columns.length &&
        found.every((header, i) => step.columns[i]?.header === header);
      if (untouched && !same) onChange(spec.path, columnsFromHeaders(found));
    });
    return () => {
      live = false;
    };
  }, [sheetKey]);

  async function refresh() {
    const found = await read();
    if (!found) return;
    const result = refreshColumns(step.columns, found);
    onChange(spec.path, result.columns);
    const parts: string[] = [];
    if (result.added.length) {
      parts.push(
        result.added.length === 1
          ? '1 new column added.'
          : `${result.added.length} new columns added.`,
      );
    }
    if (result.missing.length) {
      parts.push(
        result.missing.length === 1
          ? '1 column is no longer in the sheet.'
          : `${result.missing.length} columns are no longer in the sheet.`,
      );
    }
    setNote(parts.length ? parts.join(' ') : 'The columns match the sheet.');
  }

  if (!step.spreadsheet || !step.sheet) {
    return (
      <Text size="sm" muted id={ids.control}>
        Pick a spreadsheet and a tab to fill in its columns.
      </Text>
    );
  }

  const missing = missingHeaders(step.columns, headers);
  const write = (i: number, value: string) =>
    onChange(
      spec.path,
      step.columns.map((column, j) => (j === i ? { ...column, value } : column)),
    );

  return (
    // biome-ignore lint/a11y/useSemanticElements: the columns, named by the field's label
    <div role="group" aria-labelledby={ids.label} className="flex flex-col gap-3">
      {problem ? <Problem>{problem}</Problem> : null}
      {headers !== null && headers.length === 0 ? (
        <Alert variant="warning" className="items-center p-3" data-testid="no-header-row">
          <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2.5} />
          <span>{NO_HEADER_ROW}</span>
        </Alert>
      ) : null}

      {step.columns.length === 0 ? (
        <Text size="sm" muted>
          {loading ? 'Reading the header row...' : 'No columns yet.'}
        </Text>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {step.columns.map((column, i) => {
            const path = joinPath(spec.path, String(i));
            const gone = missing.has(column.header);
            const error = errors[`${i}.value`] ?? errors[`${i}.header`] ?? errors[String(i)];
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: two columns may share a header; their place is their identity
                key={i}
                {...{ [FIELD_PATH_ATTRIBUTE]: path }}
                className={`flex flex-col gap-2 rounded-md border-2 bg-inset p-3 ${
                  gone ? 'border-actionDanger' : 'border-outline'
                }`}
                data-missing={gone || undefined}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`min-w-0 flex-1 truncate font-sans text-sm font-bold ${
                      gone ? 'text-dangerInk' : 'text-ink'
                    }`}
                  >
                    {column.header || `Column ${i + 1}`}
                  </span>
                  {gone ? (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      className="h-8 w-8 shrink-0 px-0"
                      onClick={() =>
                        onChange(
                          spec.path,
                          step.columns.filter((_, j) => j !== i),
                        )
                      }
                    >
                      <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
                      <span className="sr-only">Remove {column.header}</span>
                    </Button>
                  ) : null}
                </div>
                {gone ? (
                  <Text size="xs" className="text-dangerInk">
                    This column is no longer in the sheet.
                  </Text>
                ) : null}
                <div {...{ [FIELD_PATH_ATTRIBUTE]: `${path}.value` }}>
                  <ChipInput
                    value={column.value}
                    onChange={(next) => write(i, next)}
                    label={`${column.header || `Column ${i + 1}`} value`}
                    fieldPath={`${path}.value`}
                    placeholder="Enter your value, or leave it empty"
                    insertButton="icon"
                    invalid={error !== undefined}
                  />
                </div>
                {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <MotionIcon icon={RefreshCwIcon} className="h-4 w-4" />
          {loading ? 'Reading...' : 'Refresh Columns'}
        </Button>
        {note ? (
          <Text size="xs" muted as="span" aria-live="polite">
            {note}
          </Text>
        ) : null}
      </div>
      {errors[''] ? <FormErrorMessage>{errors['']}</FormErrorMessage> : null}
    </div>
  );
}
