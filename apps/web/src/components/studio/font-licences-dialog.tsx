'use client';

/**
 * Font Licences (Sprint 9b): every family the Studio offers, by name, with
 * its licence, its designer where the file names one, and the copyright
 * notice from the file itself, word for word.
 *
 * Both licences the library allows (the SIL Open Font License and the Apache
 * License) ask that the notice travel with the font, and an exported design
 * carries its fonts inside it, so the notices sit one click from the pickers.
 * The names are set in the panel's own face rather than each family's, so
 * opening the list downloads no font files.
 */
import { FileTextIcon } from '@animateicons/react/lucide/file-text-icon';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  MotionIcon,
} from '@postgear/ui';
import { useState } from 'react';
import { type FontLicenceRow, fontLicenceRows } from './editor-panel-model';

export function FontLicencesDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <MotionIcon icon={FileTextIcon} className="h-4 w-4" />
          Font Licences
        </Button>
      </DialogTrigger>
      <DialogContent
        data-testid="font-licences-dialog"
        className="flex max-h-[90vh] max-w-2xl flex-col gap-0 p-0"
      >
        <DialogHeader className="px-6 pt-6 pb-4 pe-14">
          <DialogTitle>Font Licences</DialogTitle>
          <DialogDescription>
            Every font in Studio, with the licence it is shared under and its copyright notice.
          </DialogDescription>
        </DialogHeader>
        {/* Built only while open: the list is long, and the panel opens often. */}
        {open ? <LicenceList rows={fontLicenceRows()} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function LicenceList({ rows }: { rows: readonly FontLicenceRow[] }) {
  return (
    <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-3 overflow-y-auto px-6 pt-1 pb-6 pg-scrollbar pg-scrollbar-secondary">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex min-w-0 flex-col gap-2 rounded-md border-2 border-outline bg-secondary p-3"
        >
          <h3 className="m-0 type-heading text-sm text-ink">{row.label}</h3>
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-sans text-xs text-ink">
            <dt className="type-label">Licence</dt>
            <dd className="m-0">{row.licence}</dd>
            {row.designer ? (
              <>
                <dt className="type-label">Designer</dt>
                <dd className="m-0 wrap-anywhere">{row.designer}</dd>
              </>
            ) : null}
            <dt className="type-label">Copyright</dt>
            <dd className="m-0 wrap-anywhere">{row.copyright}</dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}
