'use client';

/**
 * One library item, the takedown view (module 19 section 9): its picture or
 * sound, its licence evidence, "{N} clips use this item", and the actions its
 * status allows. Each action asks for a reason; Remove Item is a red confirm
 * that deletes the files and puts the item on the deny list for good.
 */
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  toast,
} from '@postgear/ui';
import { Info, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { LibraryItemAction, LibraryItemDetail, LibraryItemType } from '@/types/operator';
import { errorSentence, ReasonField } from './operator-fields';
import {
  categoryName,
  dateTime,
  durationLabel,
  ITEM_ACTION_DONE,
  ITEM_ACTION_NAMES,
  ITEM_ACTION_SENTENCES,
  itemActions,
  LIBRARY_KIND_NAMES,
  LIBRARY_STATUS_NAMES,
  reasonError,
  usageSentence,
} from './operator-model';

export function LibraryItemDialog({
  type,
  itemId,
  onClose,
  onChanged,
}: {
  type: LibraryItemType;
  itemId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [item, setItem] = useState<LibraryItemDetail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [action, setAction] = useState<LibraryItemAction | null>(null);
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      setItem(await api<LibraryItemDetail>(`/operator/library/items/${type}/${itemId}`));
    } catch (caught) {
      setFailed(errorSentence(caught));
    }
  }, [type, itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  function choose(next: LibraryItemAction | null) {
    setAction(next);
    setAttempted(false);
    setError(null);
  }

  async function run() {
    if (!action || !item) return;
    setAttempted(true);
    if (reasonError(reason)) return;
    setSaving(true);
    setError(null);
    try {
      const next = await api<LibraryItemDetail>(
        `/operator/library/items/${type}/${item.id}/${action}`,
        {
          method: 'POST',
          body: { reason: reason.trim() },
        },
      );
      toast({ title: ITEM_ACTION_DONE[action] });
      setItem(next);
      setReason('');
      choose(null);
      onChanged();
    } catch (caught) {
      setError(errorSentence(caught));
    } finally {
      setSaving(false);
    }
  }

  const blockedByGuard =
    item && (action === 'publish' || action === 'restore') ? item.publishRefusal : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto pg-scrollbar">
        <div className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{item ? item.name : type === 'sound' ? 'Sound' : 'Sticker'}</DialogTitle>
            <DialogDescription>
              {item ? usageSentence(item.usage) : 'Reading the item and the clips that use it.'}
            </DialogDescription>
          </DialogHeader>

          {failed ? <p className="m-0 font-sans text-sm text-dangerInk">{failed}</p> : null}
          {!item && !failed ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : null}

          {item ? (
            <>
              <div className="flex gap-4">
                <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-inset">
                  {item.previewUrl ? (
                    // biome-ignore lint/performance/noImgElement: a library item served from the media bucket.
                    <img
                      src={item.previewUrl}
                      alt=""
                      className="max-h-28 max-w-28 object-contain"
                    />
                  ) : item.audioUrl ? (
                    // biome-ignore lint/a11y/useMediaCaption: a sound effect or a music bed has no words to caption.
                    <audio controls src={item.audioUrl} className="w-28" preload="none" />
                  ) : (
                    <span className="px-2 text-center font-sans text-xs text-ink type-muted">
                      Files removed
                    </span>
                  )}
                </div>
                <dl className="m-0 grid min-w-0 flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border-2 border-outline bg-inset p-3 font-sans text-xs text-ink">
                  <dt className="type-muted">Status</dt>
                  <dd className="m-0">
                    <Badge variant="outline">{LIBRARY_STATUS_NAMES[item.status]}</Badge>
                    {item.statusAt ? (
                      <span className="ms-2 type-muted">
                        {dateTime(item.statusAt)}
                        {item.statusByEmail ? `, ${item.statusByEmail}` : ''}
                      </span>
                    ) : null}
                  </dd>
                  {item.statusReason ? (
                    <>
                      <dt className="type-muted">Why</dt>
                      <dd className="m-0">{item.statusReason}</dd>
                    </>
                  ) : null}
                  <dt className="type-muted">Kind</dt>
                  <dd className="m-0">
                    {LIBRARY_KIND_NAMES[item.kind]}, {categoryName(type, item.category)}
                    {item.durationMs !== null && type === 'sound'
                      ? `, ${durationLabel(item.durationMs)}`
                      : ''}
                    {item.width && item.height ? `, ${item.width} by ${item.height} px` : ''}
                  </dd>
                  <dt className="type-muted">Licence</dt>
                  <dd className="m-0">
                    <a
                      href={item.licenceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      {item.licence}
                    </a>
                    {item.originalWork ? '' : ', not marked as an original work'}
                  </dd>
                  <dt className="type-muted">Author</dt>
                  <dd className="m-0">
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      {item.author}
                    </a>
                  </dd>
                  <dt className="type-muted">Source</dt>
                  <dd className="m-0">
                    {item.source.name} ({item.origin}
                    {item.originId ? `, ${item.originId}` : ''})
                  </dd>
                  <dt className="type-muted">Fetched</dt>
                  <dd className="m-0">{dateTime(item.retrievedAt)}</dd>
                  <dt className="type-muted">Checksum</dt>
                  <dd className="m-0 truncate font-mono" title={item.sourceChecksum}>
                    {item.sourceChecksum}
                  </dd>
                  <dt className="type-muted">Run</dt>
                  <dd className="m-0 font-mono">{item.runId}</dd>
                  {item.tags.length > 0 ? (
                    <>
                      <dt className="type-muted">Tags</dt>
                      <dd className="m-0">{item.tags.join(', ')}</dd>
                    </>
                  ) : null}
                </dl>
              </div>

              {item.usage > 0 && item.status !== 'REMOVED' ? (
                <Alert variant="info" className="items-center">
                  <Info className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
                  <p className="m-0 min-w-0 flex-1">
                    Hiding keeps those clips working. Removing shows them a notice, and their export
                    asks for the item to be taken out.
                  </p>
                </Alert>
              ) : null}

              {item.publishRefusal && (item.status === 'STAGED' || item.status === 'HIDDEN') ? (
                <Alert variant="warning" className="items-center">
                  <TriangleAlert
                    className="h-5 w-5 shrink-0"
                    strokeWidth={2.5}
                    aria-hidden="true"
                  />
                  <p className="m-0 min-w-0 flex-1">{item.publishRefusal}</p>
                </Alert>
              ) : null}

              {action ? (
                <form
                  className="flex flex-col gap-4 rounded-md border-2 border-outline bg-inset p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run();
                  }}
                >
                  <p className="m-0 font-sans text-sm text-ink">{ITEM_ACTION_SENTENCES[action]}</p>
                  <ReasonField
                    value={reason}
                    onChange={setReason}
                    attempted={attempted}
                    disabled={saving}
                  />
                  {error ? (
                    <Alert variant="danger" className="items-center">
                      <TriangleAlert
                        className="h-5 w-5 shrink-0"
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
                      <p className="m-0 min-w-0 flex-1">{error}</p>
                    </Alert>
                  ) : null}
                  <div className="flex justify-end gap-3">
                    <Button variant="secondary" onClick={() => choose(null)} disabled={saving}>
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant={action === 'remove' ? 'danger' : 'primary'}
                      disabled={saving || Boolean(blockedByGuard)}
                    >
                      {saving ? 'Saving' : ITEM_ACTION_NAMES[action]}
                    </Button>
                  </div>
                </form>
              ) : null}
            </>
          ) : null}

          {item && !action ? (
            <DialogFooter>
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
              {itemActions(item.status).map((next) => (
                <Button
                  key={next}
                  variant={next === 'remove' ? 'danger' : next === 'hide' ? 'secondary' : 'primary'}
                  disabled={
                    (next === 'publish' || next === 'restore') && Boolean(item.publishRefusal)
                  }
                  onClick={() => choose(next)}
                >
                  {ITEM_ACTION_NAMES[next]}
                </Button>
              ))}
            </DialogFooter>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
