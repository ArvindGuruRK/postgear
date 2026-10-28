'use client';

/**
 * New Brand Kit and Edit Brand Kit (DS-2.1, DS-2.2, DS-2.3, DS-2.5).
 *
 * One dialog, two screens. The form takes everything by hand. Extract From
 * Website reads the site and opens the review screen, where every value it
 * found can be changed: another logo, a colour given another role, a colour
 * removed or added. Nothing is stored until Save Brand Kit, a found logo
 * included: it is uploaded only then, from the bytes the review screen
 * already holds. A site that cannot be read leaves the form open with the
 * API's sentence, so nobody is ever stuck.
 *
 * A real slide in the kit's colours sits beside both screens and follows
 * every change. The API answers a malformed body with "Invalid input" only,
 * so every rule is checked here first, in the API's own sentences.
 *
 * Sprint 9b adds, on both screens: the kit's Fonts (Heading and Body, Theme
 * Font for none), its Call To Action (the words and the link a new design's
 * closing slide starts with) and Lock Brand Look. The form's Colours also
 * offer From One Colour, which fills all five from one (`kit-from-color.tsx`).
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { GlobeIcon } from '@animateicons/react/lucide/globe-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import { UploadIcon } from '@animateicons/react/lucide/upload-icon';
import { WandSparklesIcon } from '@animateicons/react/lucide/wand-sparkles-icon';
import { BRAND_COLOR_KEYS, type BrandColors } from '@postgear/design-engine';
import {
  Alert,
  AlertDescription,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormErrorMessage,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  MotionIcon,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Textarea,
  Toggle,
  toast,
} from '@postgear/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { BrandExtraction, BrandKitView, LogoCandidate } from '@/types/studio';
import { ColorField } from './color-field';
import { FontSelect } from './font-select';
import {
  ctaUrlProblem,
  extrasBody,
  extrasDraft,
  type KitExtrasDraft,
  LOCK_LOOK_NOTE,
  MAX_CTA_TEXT_LENGTH,
  MAX_CTA_URL_LENGTH,
} from './kit-extras-model';
import { KitFromColor } from './kit-from-color';
import { groundOf } from './kit-palette-model';
import { KitPreview, KitSwatches } from './kit-preview';
import { LOGO_ACCEPT, LOGO_RULE, LogoField, LogoTile, logoProblem, uploadLogo } from './logo-field';
import {
  addFoundColor,
  assignRole,
  type BrandKitDraft,
  brandKitBody,
  brandKitProblems,
  COLOR_LABELS,
  type ColorRoleChoice,
  draftFromKit,
  extractionSummary,
  type FoundColor,
  fileFromDataUri,
  foundColors,
  HEX_ERROR,
  hasProblems,
  hexFromInput,
  kitColors,
  MAX_FOUND_COLORS,
  MAX_FOUND_LOGOS,
  MAX_KIT_DESCRIPTION_LENGTH,
  MAX_KIT_NAME_LENGTH,
  newKitDraft,
  prefillField,
  validColors,
  WEBSITE_ERROR,
  websiteProblem,
} from './studio-view-model';

/** Which logo the kit saves: none, the one it has, a file chosen here, or a found one. */
type LogoPick = 'none' | 'saved' | 'file' | number;

/** What the last extraction found, as the review screen holds it. */
interface Found {
  /** Tells one extraction's logos from the next one's. */
  seq: number;
  finalUrl: string;
  /** The name and description as they were put into the fields. */
  name: string | null;
  description: string | null;
  logos: LogoCandidate[];
  summary: string;
}

/** A logo the API refused at save time: its sentence belongs at the logo. */
class LogoRefused extends Error {}

const ROLE_OPTIONS: ReadonlyArray<{ value: ColorRoleChoice; label: string }> = [
  ...BRAND_COLOR_KEYS.map((key) => ({ value: key, label: COLOR_LABELS[key] })),
  { value: 'none', label: 'Not Used' },
];

const UNREACHABLE = 'PostGear could not be reached. Check your connection and try again.';

const LOGO_TYPE_NAMES: Record<string, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
  'image/svg+xml': 'SVG',
  'image/webp': 'WebP',
};

function clip(value: string | null, max: number): string | null {
  return value?.trim().slice(0, max) || null;
}

export function BrandKitDialog({
  kit,
  onClose,
  onSaved,
}: {
  /** The kit to edit, or null for a new one. */
  kit: BrandKitView | null;
  onClose: () => void;
  onSaved: (kit: BrandKitView) => void;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const reviewTop = useRef<HTMLDivElement>(null);
  const websiteInput = useRef<HTMLInputElement>(null);
  const fromOneButton = useRef<HTMLButtonElement>(null);

  const [fallback] = useState<BrandColors>(() => kit?.colors ?? newKitDraft().colors);
  const [draft, setDraft] = useState<BrandKitDraft>(() =>
    kit ? draftFromKit(kit) : newKitDraft(),
  );
  const [reviewing, setReviewing] = useState(false);
  const [saved] = useState(() =>
    kit?.logoMediaId && kit.logoUrl ? { mediaId: kit.logoMediaId, url: kit.logoUrl } : null,
  );
  const [own, setOwn] = useState<{ file: File; url: string } | null>(null);
  const [pick, setPick] = useState<LogoPick>(() => (saved ? 'saved' : 'none'));
  const [found, setFound] = useState<Found | null>(null);
  const [rows, setRows] = useState<FoundColor[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [extras, setExtras] = useState<KitExtrasDraft>(() => extrasDraft(kit));
  /** From One Colour is open under the Colours fields. */
  const [fromOne, setFromOne] = useState(false);

  /** Bumped by every reading and by anything that makes one stale. */
  const ticket = useRef(0);
  const ownUrl = useRef<string | null>(null);
  /** Logos already uploaded by an attempt that failed later, so a retry does not upload twice. */
  const uploads = useRef(new Map<string, string>());

  // The kit pointed at a logo that is gone from the media library.
  const logoGone = Boolean(kit?.logoMediaId && !kit.logoUrl);

  useEffect(
    () => () => {
      if (ownUrl.current) URL.revokeObjectURL(ownUrl.current);
    },
    [],
  );

  useEffect(() => {
    if (reviewing) reviewTop.current?.focus();
  }, [reviewing]);

  const base = validColors(draft.colors, fallback);
  const byRole = reviewing && rows.length > 0;
  const typedColors = byRole ? kitColors(rows, base) : draft.colors;
  const problems = brandKitProblems({ ...draft, colors: typedColors });
  const ctaProblem = ctaUrlProblem(extras.ctaUrl);
  const previewColors = validColors(typedColors, base);
  const shows = (key: string) => submitted || touched.has(key);

  function touch(key: string) {
    setTouched((current) => (current.has(key) ? current : new Set(current).add(key)));
  }

  function change(patch: Partial<BrandKitDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setSaveError(null);
  }

  function changeColor(key: keyof BrandColors, value: string) {
    setDraft((current) => ({ ...current, colors: { ...current.colors, [key]: value } }));
    setSaveError(null);
  }

  function changeExtras(patch: Partial<KitExtrasDraft>) {
    setExtras((current) => ({ ...current, ...patch }));
    setSaveError(null);
  }

  /** From One Colour's Use These Colours: all five fields at once, which can still be changed after. */
  function applyColors(colors: BrandColors) {
    setDraft((current) => ({ ...current, colors: { ...colors } }));
    setSaveError(null);
    setFromOne(false);
    setAnnouncement(`The five colours were filled in from ${colors.primary}.`);
    requestAnimationFrame(() => fromOneButton.current?.focus());
  }

  function urlOf(choice: LogoPick): string | null {
    if (choice === 'saved') return saved?.url ?? null;
    if (choice === 'file') return own?.url ?? null;
    if (typeof choice === 'number') return found?.logos[choice]?.preview ?? null;
    return null;
  }

  function chooseFile(file: File) {
    if (ownUrl.current) URL.revokeObjectURL(ownUrl.current);
    const url = URL.createObjectURL(file);
    ownUrl.current = url;
    setOwn({ file, url });
    setPick('file');
    setLogoError(null);
  }

  function choose(choice: LogoPick) {
    setPick(choice);
    setLogoError(null);
  }

  /** The logo to fall back on when an extraction offers none. */
  function keptPick(current: LogoPick): LogoPick {
    if (typeof current !== 'number') return current;
    if (saved) return 'saved';
    return own ? 'file' : 'none';
  }

  async function extract() {
    const url = draft.websiteUrl.trim();
    const problem = url ? websiteProblem(url) : WEBSITE_ERROR;
    touch('website');
    if (problem) {
      setSiteError(problem);
      websiteInput.current?.focus();
      return;
    }

    const mine = ++ticket.current;
    setExtracting(true);
    setNotice(null);
    setSiteError(null);
    setAnnouncement('Reading your website…');

    try {
      const { extraction } = await api<{ extraction: BrandExtraction }>(
        '/studio/brand-kits/extract',
        { method: 'POST', body: { url } },
      );
      if (mine === ticket.current) review(extraction);
    } catch (cause) {
      if (mine !== ticket.current) return;

      const message = cause instanceof ApiError ? cause.message : UNREACHABLE;
      // A refused address is about what was typed, so it sits under the
      // field. A site that could not be read is not, and leaves the form
      // just as it was for the details to be entered by hand. Either one
      // announces itself (the field's error, the notice's status alert), so
      // the live region does not repeat it.
      if (cause instanceof ApiError && (cause.status === 400 || cause.code === 'extract_private')) {
        setSiteError(message);
      } else {
        setNotice(message);
      }
      setAnnouncement('');
    } finally {
      if (mine === ticket.current) setExtracting(false);
    }
  }

  function review(extraction: BrandExtraction) {
    const logos = extraction.logos.slice(0, MAX_FOUND_LOGOS);
    const summary = extractionSummary(extraction);
    const previous = found;

    setDraft((current) => ({
      ...current,
      websiteUrl: extraction.url,
      name: prefillField(
        current.name,
        extraction.name,
        previous?.name ?? null,
        MAX_KIT_NAME_LENGTH,
      ),
      description: prefillField(
        current.description,
        extraction.description,
        previous?.description ?? null,
        MAX_KIT_DESCRIPTION_LENGTH,
      ),
    }));
    setFound({
      seq: (previous?.seq ?? 0) + 1,
      finalUrl: extraction.finalUrl,
      name: clip(extraction.name, MAX_KIT_NAME_LENGTH),
      description: clip(extraction.description, MAX_KIT_DESCRIPTION_LENGTH),
      logos,
      summary,
    });
    setRows(foundColors(extraction.colors));
    setPick((current) => (logos.length > 0 ? 0 : keptPick(current)));
    setLogoError(null);
    setSubmitted(false);
    setTouched(new Set());
    setReviewing(true);
    setAnnouncement(summary);
  }

  /** Back to the form, which takes the colours the review gave each role. */
  function back() {
    if (rows.length > 0) {
      const usable = rows.flatMap((row) => {
        const hex = hexFromInput(row.hex);
        return hex ? [{ ...row, hex }] : [];
      });
      setDraft((current) => ({
        ...current,
        colors: kitColors(usable, validColors(current.colors, fallback)),
      }));
    }
    setReviewing(false);
    setSubmitted(false);
    requestAnimationFrame(() => websiteInput.current?.focus());
  }

  /** The logo's media id, uploading the chosen one first if the library does not have it yet. */
  async function settleLogo(): Promise<string | null> {
    if (pick === 'none') return null;
    if (pick === 'saved') return saved?.mediaId ?? null;

    const key = pick === 'file' ? `file:${own?.url}` : `found:${found?.seq}:${pick}`;
    const known = uploads.current.get(key);
    if (known) return known;

    const file =
      pick === 'file'
        ? (own?.file ?? null)
        : fileFromDataUri(
            found?.logos[pick]?.preview ?? '',
            `${draft.name.trim() || 'Brand'} Logo`,
          );
    if (!file) throw new LogoRefused('That logo could not be read. Choose another one.');

    setProgress(0);
    try {
      const media = await uploadLogo(file, setProgress);
      uploads.current.set(key, media.id);
      return media.id;
    } catch (cause) {
      throw new LogoRefused(
        cause instanceof ApiError
          ? cause.message
          : 'The logo could not be uploaded. Check your connection and try again.',
      );
    } finally {
      setProgress(null);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    setSubmitted(true);
    setSaveError(null);

    if (hasProblems(problems) || ctaProblem) {
      setAnnouncement('Some fields need a fix before this brand kit can be saved.');
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }

    // A reading still in flight would open the review over a kit being saved.
    ticket.current++;
    setExtracting(false);
    setSaving(true);
    setLogoError(null);

    try {
      const logoMediaId = await settleLogo();
      const body = brandKitBody(
        { ...draft, colors: typedColors, logoMediaId },
        found ? 'EXTRACTED' : (kit?.source ?? 'MANUAL'),
      );
      if (!body) return;
      // An unchanged logo is left out: the API checks a logo it is sent, and
      // that check is only worth making for a new one.
      if (kit && body.logoMediaId === kit.logoMediaId) delete body.logoMediaId;

      const { brandKit } = await api<{ brandKit: BrandKitView }>(
        kit ? `/studio/brand-kits/${encodeURIComponent(kit.id)}` : '/studio/brand-kits',
        { method: kit ? 'PATCH' : 'POST', body: { ...body, ...extrasBody(extras) } },
      );

      toast(
        kit
          ? {
              title: 'Brand kit updated',
              description:
                'New designs use it. Designs made before keep their colours and fonts until you choose Update From Kit.',
            }
          : {
              title: 'Brand kit saved',
              description: `${brandKit.name} is ready for your designs.`,
            },
      );
      onSaved(brandKit);
    } catch (cause) {
      if (cause instanceof LogoRefused) {
        setLogoError(cause.message);
        setAnnouncement(cause.message);
      } else {
        setSaveError(cause instanceof ApiError ? cause.message : UNREACHABLE);
      }
    } finally {
      setSaving(false);
    }
  }

  const nameError = shows('name') ? problems.name : null;
  const websiteError = siteError ?? (shows('website') ? problems.websiteUrl : null);
  const colorErrors = Object.fromEntries(
    BRAND_COLOR_KEYS.map((key) => [key, shows(`color:${key}`) ? problems.colors[key] : null]),
  ) as Record<keyof BrandColors, string | null>;

  const nameFields = (
    <>
      <FormField>
        <FormLabel htmlFor={`${id}-name`} required>
          Brand name
        </FormLabel>
        <Input
          id={`${id}-name`}
          value={draft.name}
          maxLength={MAX_KIT_NAME_LENGTH}
          autoComplete="organization"
          placeholder="Enter your brand name"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? `${id}-name-error` : undefined}
          onChange={(event) => change({ name: event.target.value })}
          onBlur={() => touch('name')}
        />
        {nameError ? (
          <FormErrorMessage id={`${id}-name-error`}>{nameError}</FormErrorMessage>
        ) : null}
      </FormField>

      <FormField>
        <FormLabel htmlFor={`${id}-description`}>Description</FormLabel>
        <Textarea
          id={`${id}-description`}
          value={draft.description}
          maxLength={MAX_KIT_DESCRIPTION_LENGTH}
          rows={2}
          placeholder="Enter your brand description"
          aria-describedby={`${id}-description-hint`}
          onChange={(event) => change({ description: event.target.value })}
        />
        <FormHelperText id={`${id}-description-hint`}>
          Optional. One or two lines about what you do.
        </FormHelperText>
      </FormField>
    </>
  );

  const colorFields = (
    <div className="grid gap-4 sm:grid-cols-2">
      {BRAND_COLOR_KEYS.map((key) => (
        <ColorField
          key={key}
          label={COLOR_LABELS[key]}
          value={draft.colors[key]}
          error={colorErrors[key]}
          onChange={(value) => changeColor(key, value)}
          onBlur={() => touch(`color:${key}`)}
        />
      ))}
    </div>
  );

  const fromOneId = `${id}-from-one`;
  const fromOneColour = (
    <div className="flex flex-col gap-3">
      <div>
        <Button
          ref={fromOneButton}
          type="button"
          variant="secondary"
          size="sm"
          disabled={saving}
          aria-expanded={fromOne}
          aria-controls={fromOne ? fromOneId : undefined}
          onClick={() => setFromOne((open) => !open)}
        >
          <MotionIcon icon={WandSparklesIcon} className="h-4 w-4" />
          From One Colour
        </Button>
      </div>
      {fromOne ? (
        <KitFromColor
          id={fromOneId}
          start={base.primary}
          startGround={groundOf(base.background)}
          disabled={saving}
          onUse={applyColors}
          onCancel={() => {
            setFromOne(false);
            requestAnimationFrame(() => fromOneButton.current?.focus());
          }}
        />
      ) : null}
    </div>
  );

  const ctaUrlError = shows('cta-url') ? ctaProblem : null;
  const extraFields = (
    <>
      <Group label="Fonts">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField>
            <FormLabel htmlFor={`${id}-heading-font`}>Heading</FormLabel>
            <FontSelect
              id={`${id}-heading-font`}
              value={extras.headingFont}
              defaultLabel="Theme Font"
              disabled={saving}
              className="w-full"
              onChange={(headingFont) => changeExtras({ headingFont })}
            />
          </FormField>
          <FormField>
            <FormLabel htmlFor={`${id}-body-font`}>Body</FormLabel>
            <FontSelect
              id={`${id}-body-font`}
              value={extras.bodyFont}
              defaultLabel="Theme Font"
              disabled={saving}
              className="w-full"
              onChange={(bodyFont) => changeExtras({ bodyFont })}
            />
          </FormField>
        </div>
      </Group>

      <Group label="Call To Action">
        <p id={`${id}-cta-note`} className="m-0 font-sans text-sm text-ink type-muted">
          Optional. A new design's closing slide starts with these.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField>
            <FormLabel htmlFor={`${id}-cta-text`}>CTA text</FormLabel>
            <Input
              id={`${id}-cta-text`}
              value={extras.ctaText}
              maxLength={MAX_CTA_TEXT_LENGTH}
              placeholder="Enter your call to action"
              aria-describedby={`${id}-cta-note`}
              onChange={(event) => changeExtras({ ctaText: event.target.value })}
            />
          </FormField>
          <FormField>
            <FormLabel htmlFor={`${id}-cta-url`}>Link</FormLabel>
            <Input
              id={`${id}-cta-url`}
              value={extras.ctaUrl}
              maxLength={MAX_CTA_URL_LENGTH}
              inputMode="url"
              spellCheck={false}
              autoComplete="off"
              placeholder="Enter your link"
              aria-invalid={ctaUrlError ? true : undefined}
              aria-describedby={ctaUrlError ? `${id}-cta-url-error` : `${id}-cta-note`}
              onChange={(event) => changeExtras({ ctaUrl: event.target.value })}
              onBlur={() => touch('cta-url')}
            />
            {ctaUrlError ? (
              <FormErrorMessage id={`${id}-cta-url-error`}>{ctaUrlError}</FormErrorMessage>
            ) : null}
          </FormField>
        </div>
      </Group>

      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <FormLabel htmlFor={`${id}-lock`}>Lock brand look</FormLabel>
          <FormHelperText id={`${id}-lock-note`}>{LOCK_LOOK_NOTE}</FormHelperText>
        </div>
        <Toggle
          id={`${id}-lock`}
          checked={extras.lockLook}
          disabled={saving}
          aria-describedby={`${id}-lock-note`}
          onCheckedChange={(lockLook) => changeExtras({ lockLook })}
        />
      </div>
    </>
  );

  const title = reviewing ? 'Review Your Brand' : kit ? 'Edit Brand Kit' : 'New Brand Kit';
  const description = reviewing
    ? `${found?.summary ?? ''} Change anything you like. Nothing is saved until you choose Save Brand Kit.`
    : kit
      ? 'Changes apply to new designs. Designs made before keep their colours until you update them.'
      : 'Paste your website to fill this in for you, or enter the details yourself.';

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] max-w-3xl overflow-y-auto pg-scrollbar pg-scrollbar-secondary"
        // Typing is lost on close, so a stray click beside the dialog must
        // not close it; Cancel, the close button and Escape still do.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <form ref={form} onSubmit={save} noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>

          <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_14rem]">
            <div ref={reviewTop} tabIndex={-1} className="flex min-w-0 flex-col gap-6 outline-none">
              {reviewing ? (
                <>
                  {nameFields}

                  <Group label="Logo">
                    <LogoChoices
                      logos={found?.logos ?? []}
                      saved={saved}
                      own={own}
                      pick={pick}
                      disabled={saving}
                      progress={progress}
                      error={logoError}
                      onChoose={choose}
                      onFile={chooseFile}
                    />
                  </Group>

                  <Group label="Colours">
                    {rows.length > 0 ? (
                      <FoundColorRows
                        rows={rows}
                        disabled={saving}
                        showError={(row) => shows(`row:${row.id}`)}
                        onRows={(next) => {
                          setRows(next);
                          setSaveError(null);
                        }}
                        onBlur={(row) => touch(`row:${row.id}`)}
                        newHex={(role) => (role === 'none' ? base.primary : base[role])}
                      />
                    ) : (
                      <>
                        <p className="m-0 font-sans text-sm text-ink type-muted">
                          We found no colours worth using on that site. Pick your own below.
                        </p>
                        {colorFields}
                      </>
                    )}
                  </Group>

                  {extraFields}
                </>
              ) : (
                <>
                  <FormField>
                    <FormLabel htmlFor={`${id}-website`}>Website URL</FormLabel>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        ref={websiteInput}
                        id={`${id}-website`}
                        type="url"
                        inputMode="url"
                        value={draft.websiteUrl}
                        autoComplete="url"
                        spellCheck={false}
                        placeholder="Enter your website address"
                        aria-invalid={websiteError ? true : undefined}
                        aria-describedby={`${id}-website-note`}
                        onChange={(event) => {
                          // A reading of the old address no longer applies.
                          ticket.current++;
                          setExtracting(false);
                          setSiteError(null);
                          setNotice(null);
                          change({ websiteUrl: event.target.value });
                        }}
                        onBlur={() => touch('website')}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return;
                          event.preventDefault();
                          if (!extracting && draft.websiteUrl.trim()) void extract();
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        className="shrink-0"
                        disabled={extracting || saving || draft.websiteUrl.trim() === ''}
                        onClick={() => void extract()}
                      >
                        {extracting ? (
                          <Spinner
                            size="sm"
                            role="presentation"
                            aria-hidden="true"
                            className="motion-reduce:animate-none"
                          />
                        ) : (
                          <MotionIcon icon={GlobeIcon} className="h-4 w-4" />
                        )}
                        {extracting ? 'Reading your website…' : 'Extract From Website'}
                      </Button>
                    </div>
                    {websiteError ? (
                      <FormErrorMessage id={`${id}-website-note`}>{websiteError}</FormErrorMessage>
                    ) : (
                      <FormHelperText id={`${id}-website-note`}>
                        Optional. PostGear can read your name, logo and colours from it.
                      </FormHelperText>
                    )}
                  </FormField>

                  {notice ? (
                    <Alert variant="warning" role="status">
                      <AlertDescription>{notice}</AlertDescription>
                    </Alert>
                  ) : null}

                  {nameFields}

                  <Group label="Logo">
                    <LogoField
                      previewUrl={urlOf(pick)}
                      name={draft.name}
                      disabled={saving}
                      progress={progress}
                      error={logoError}
                      onPick={chooseFile}
                      onRemove={() => choose('none')}
                    />
                    {logoGone && pick === 'none' ? (
                      <FormHelperText>
                        The logo this kit had was deleted from your media library. Upload it again
                        to keep using it.
                      </FormHelperText>
                    ) : null}
                  </Group>

                  <Group label="Colours">
                    {fromOneColour}
                    {colorFields}
                  </Group>

                  {extraFields}
                </>
              )}
            </div>

            <aside
              aria-label="Preview"
              className="flex flex-col gap-3 md:sticky md:top-0 md:self-start"
            >
              <div className="overflow-hidden rounded-md border-2 border-outline shadow-brutalSm">
                <KitPreview
                  name={draft.name}
                  colors={previewColors}
                  logoUrl={urlOf(pick)}
                  fonts={{ heading: extras.headingFont, body: extras.bodyFont }}
                  label={`A slide in the colours of ${draft.name.trim() || 'this brand kit'}`}
                />
              </div>
              <KitSwatches colors={previewColors} />
            </aside>
          </div>

          {saveError ? (
            <Alert variant="danger" className="mt-6">
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter className="flex-wrap">
            {reviewing ? (
              <Button
                type="button"
                variant="secondary"
                className="sm:mr-auto"
                disabled={saving}
                onClick={back}
              >
                <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
                Back
              </Button>
            ) : null}
            <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || draft.name.trim() === ''}>
              {saving ? 'Saving…' : 'Save Brand Kit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A labelled block of the form whose parts have labels of their own. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="mb-3 p-0 font-sans text-sm font-bold text-ink">{label}</legend>
      {children}
    </fieldset>
  );
}

function logoDetail(logo: LogoCandidate): string {
  return [
    logo.width && logo.height ? `${logo.width} x ${logo.height}` : null,
    LOGO_TYPE_NAMES[logo.mimeType] ?? null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** The review screen's logos: each one found, the kit's own, an upload, or none. */
function LogoChoices({
  logos,
  saved,
  own,
  pick,
  disabled,
  progress,
  error,
  onChoose,
  onFile,
}: {
  logos: LogoCandidate[];
  saved: { url: string } | null;
  own: { file: File; url: string } | null;
  pick: LogoPick;
  disabled: boolean;
  progress: number | null;
  error: string | null;
  onChoose: (pick: LogoPick) => void;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = problem ?? error;

  return (
    <div className="flex flex-col gap-3">
      <RadioGroup
        value={typeof pick === 'number' ? `found-${pick}` : pick}
        onValueChange={(value) =>
          onChoose(value.startsWith('found-') ? Number(value.slice(6)) : (value as LogoPick))
        }
        disabled={disabled}
        aria-label="Logo"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3"
      >
        {logos.map((logo, index) => (
          <LogoOption
            // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed for one extraction; two logos may share a source
            key={index}
            value={`found-${index}`}
            label={`Logo ${index + 1}`}
            detail={logoDetail(logo)}
            url={logo.preview}
          />
        ))}
        {saved ? <LogoOption value="saved" label="Current Logo" url={saved.url} /> : null}
        {own ? (
          <LogoOption value="file" label="Your Upload" detail={own.file.name} url={own.url} />
        ) : null}
        <LogoOption value="none" label="No Logo" url={null} />
      </RadioGroup>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <MotionIcon icon={UploadIcon} className="h-4 w-4" />
          Upload Your Own
        </Button>
        <span className="font-sans text-xs text-ink type-muted">{LOGO_RULE}</span>
      </div>

      <input
        ref={input}
        type="file"
        accept={LOGO_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose a logo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;

          const reason = logoProblem(file);
          setProblem(reason);
          if (!reason) onFile(file);
        }}
      />

      {progress !== null ? (
        <Progress value={Math.round(progress * 100)} size="sm" aria-label="Uploading the logo" />
      ) : null}
      {shown ? <FormErrorMessage>{shown}</FormErrorMessage> : null}
    </div>
  );
}

function LogoOption({
  value,
  label,
  detail,
  url,
}: {
  value: string;
  label: string;
  detail?: string;
  url: string | null;
}) {
  const id = useId();

  return (
    <label
      htmlFor={id}
      className={cn(
        'relative flex min-w-0 cursor-pointer flex-col gap-2 rounded-lg border-2 border-outline bg-inset p-2 shadow-brutalSm',
        'transition-[translate,box-shadow,border-color] duration-100 motion-reduce:transition-none',
        // Pressed onto its shadow by the theme's own depth, as `pressSm` presses.
        'has-[[data-state=checked]]:translate-x-(--brutal-offset-sm) has-[[data-state=checked]]:translate-y-(--brutal-offset-sm)',
        'has-[[data-state=checked]]:border-actionPrimary has-[[data-state=checked]]:shadow-none',
        'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
      )}
    >
      <LogoTile url={url} alt="" className="h-20 w-full bg-secondary" />
      <span className="flex min-w-0 flex-col pr-7">
        <span className="type-ui text-sm text-ink">{label}</span>
        {detail ? (
          <span className="truncate font-sans text-xs text-ink type-muted">{detail}</span>
        ) : null}
      </span>
      <RadioGroupItem id={id} value={value} className="absolute bottom-3 right-2" />
    </label>
  );
}

/** The colours a site gave, each with its role: change, reassign, remove, add. */
function FoundColorRows({
  rows,
  disabled,
  showError,
  onRows,
  onBlur,
  newHex,
}: {
  rows: FoundColor[];
  disabled: boolean;
  showError: (row: FoundColor) => boolean;
  onRows: (rows: FoundColor[]) => void;
  onBlur: (row: FoundColor) => void;
  /** The colour a new row starts with, for the role it is about to be given. */
  newHex: (role: ColorRoleChoice) => string;
}) {
  const held = new Set(rows.map((row) => row.role));
  const free = BRAND_COLOR_KEYS.find((key) => !held.has(key)) ?? 'none';

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 font-sans text-sm text-ink type-muted">
        Give each colour a role. A role no colour holds keeps the colour it had.
      </p>

      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((row, index) => {
          const number = index + 1;
          const error =
            showError(row) && row.role !== 'none' && !hexFromInput(row.hex) ? HEX_ERROR : null;

          return (
            <li
              key={row.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-lg border-2 border-outline bg-inset p-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:gap-3"
            >
              <ColorField
                hideLabel
                label={`Colour ${number}`}
                value={row.hex}
                error={error}
                onChange={(hex) =>
                  onRows(rows.map((entry) => (entry.id === row.id ? { ...entry, hex } : entry)))
                }
                onBlur={() => onBlur(row)}
              />
              <Select
                value={row.role}
                disabled={disabled}
                onValueChange={(role) => onRows(assignRole(rows, row.id, role as ColorRoleChoice))}
              >
                <SelectTrigger
                  aria-label={`Role of colour ${number}`}
                  className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="secondary"
                className="w-11 px-0"
                disabled={disabled}
                aria-label={`Remove colour ${number}`}
                onClick={() => onRows(rows.filter((entry) => entry.id !== row.id))}
              >
                <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
              </Button>
            </li>
          );
        })}
      </ul>

      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || rows.length >= MAX_FOUND_COLORS}
          onClick={() => onRows(addFoundColor(rows, newHex(free)))}
        >
          <MotionIcon icon={PlusIcon} className="h-4 w-4" />
          Add Colour
        </Button>
      </div>
    </div>
  );
}
