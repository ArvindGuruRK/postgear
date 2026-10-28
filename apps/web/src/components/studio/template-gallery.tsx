'use client';

/**
 * The template gallery, the last step of Create Design (DS-3.2 to DS-3.5).
 *
 * Only templates that can be drawn in the chosen format are listed, then the
 * filters: category, style, Favourites and a search across names, categories
 * and tags. With a brand kit chosen every thumbnail is drawn in it (DS-3.3);
 * Show original colours draws the templates' own themes instead. Thumbnails
 * are drawn as they scroll near, so a library of a hundred stays smooth.
 *
 * Choosing a template creates the design on the server from the library's
 * own copy (the template itself never changes) and opens the editor; Start
 * From Blank makes a plain design in the brand's colours.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { StarIcon } from '@animateicons/react/lucide/star-icon';
import {
  BLANK_PRESET_ID,
  CATEGORY_LABELS,
  type DesignDocument,
  documentFromPreset,
  FORMATS,
  type FormatId,
  PRESET_CATEGORIES,
  PRESETS,
  type PresetCategory,
  type ThemeStyle,
} from '@postgear/design-engine';
import {
  Alert,
  AlertDescription,
  Button,
  cn,
  EmptyState,
  Label,
  MotionIcon,
  pressSm,
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Toggle,
  toast,
} from '@postgear/ui';
import { Search, Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type Ref, useDeferredValue, useId, useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { BrandKitView, DesignDetail } from '@/types/studio';
import { FOCUS } from './design-card';
import { SlideFrame } from './slide-frame';
import { INSET } from './studio-ui';
import {
  brandFromKitView,
  filterPresets,
  type GalleryFilter,
  isFiltered,
  kitLogoResolver,
  NO_FILTER,
  STYLE_LABELS,
  slideCountLabel,
} from './studio-view-model';
import { CHOSEN, StepHeader } from './wizard-steps';

const GRID =
  'm-0 grid list-none grid-cols-2 gap-4 p-0 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5';

const STYLES = Object.keys(STYLE_LABELS) as ThemeStyle[];

export function TemplateGallery({
  headingRef,
  orgId,
  format,
  kit,
  brandKitId,
  presetId,
  favourites,
  starProblem,
  onStar,
  onBack,
}: {
  headingRef: Ref<HTMLHeadingElement>;
  orgId: string;
  format: FormatId;
  /** The chosen kit, when the list has it: what the thumbnails are drawn in. */
  kit: BrandKitView | null;
  /** What the new design is made with: the kit's id, or null after Skip For Now. */
  brandKitId: string | null;
  /** A template chosen before the wizard: it leads the gallery. */
  presetId: string | null;
  favourites: ReadonlySet<string>;
  starProblem: string | null;
  onStar: (presetId: string, starred: boolean) => void;
  onBack: () => void;
}) {
  const router = useRouter();
  const switchId = useId();
  const [filter, setFilter] = useState<GalleryFilter>(NO_FILTER);
  const [original, setOriginal] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const query = useDeferredValue(filter.query);

  const brand = useMemo(() => (kit && !original ? brandFromKitView(kit) : null), [kit, original]);
  const resolve = useMemo(() => kitLogoResolver(original ? null : kit), [kit, original]);

  // Every template's document for this format and brand, built once; the
  // filters only choose among them, so typing never rebuilds a thumbnail.
  const documents = useMemo(() => {
    const map = new Map<string, DesignDocument>();
    for (const preset of PRESETS) {
      let next = 0;
      map.set(
        preset.id,
        documentFromPreset({
          presetId: preset.id,
          format,
          brand,
          newId: () => `gallery-${preset.id}-${next++}`,
        }),
      );
    }
    return map;
  }, [format, brand]);

  const presets = useMemo(() => {
    const list = filterPresets(PRESETS, format, { ...filter, query }, favourites);
    const picked = presetId ? list.find((preset) => preset.id === presetId) : undefined;
    return picked ? [picked, ...list.filter((preset) => preset !== picked)] : list;
  }, [format, filter, query, favourites, presetId]);
  // Favourites with none starred yet is not a search that missed.
  const noFavourites = filter.favourites && favourites.size === 0;

  function update(patch: Partial<GalleryFilter>) {
    setFilter((current) => ({ ...current, ...patch }));
  }

  async function create(id: string) {
    if (creating) return;
    setCreating(id);

    try {
      const { design } = await api<{ design: DesignDetail }>('/studio/designs', {
        method: 'POST',
        body: { presetId: id, format, brandKitId },
      });
      router.push(`/${orgId}/studio/${design.id}`);
    } catch (cause) {
      setCreating(null);
      toast({
        variant: 'danger',
        title: "Couldn't create the design",
        description: cause instanceof ApiError ? cause.message : 'Please try again.',
      });
    }
  }

  const spec = FORMATS[format];
  const width = `${Math.min(1, spec.width / spec.height) * 100}%`;

  return (
    <section aria-labelledby="wizard-template" className="flex flex-col gap-5">
      <StepHeader
        headingRef={headingRef}
        id="wizard-template"
        title="Choose A Template"
        sub={
          kit && !original
            ? `Shown in the colours of ${kit.name}. Pick one to open it in the editor.`
            : "Shown in each template's own colours. Pick one to open it in the editor."
        }
        aside={
          <span className="font-sans text-sm text-ink type-muted" aria-live="polite">
            {presets.length} {presets.length === 1 ? 'template' : 'templates'}
          </span>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
        <div className="lg:max-w-xs lg:flex-1">
          <SearchInput
            value={filter.query}
            onChange={(event) => update({ query: event.target.value })}
            onClear={() => update({ query: '' })}
            placeholder="Enter your search"
            aria-label="Search templates"
            className="shadow-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center">
          <Select
            value={filter.category}
            onValueChange={(value) => update({ category: value as PresetCategory | 'all' })}
          >
            {/* A row of its own on a phone: "All Categories" does not fit half of one. */}
            <SelectTrigger
              aria-label="Filter by category"
              className="col-span-2 shadow-none sm:col-span-1 sm:w-48"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {PRESET_CATEGORIES.map((category) => (
                <SelectItem key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filter.style}
            onValueChange={(value) => update({ style: value as ThemeStyle | 'all' })}
          >
            <SelectTrigger aria-label="Filter by style" className="shadow-none sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Styles</SelectItem>
              {STYLES.map((style) => (
                <SelectItem key={style} value={style}>
                  {STYLE_LABELS[style]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={filter.favourites ? 'primary' : 'secondary'}
            aria-pressed={filter.favourites}
            onClick={() => update({ favourites: !filter.favourites })}
          >
            <MotionIcon
              icon={StarIcon}
              className={cn('h-4 w-4', filter.favourites && 'fill-current')}
            />
            Favourites
          </Button>
        </div>
        {kit ? (
          <div className="flex items-center gap-3 lg:ms-auto">
            <Toggle id={switchId} checked={original} onCheckedChange={setOriginal} />
            <Label htmlFor={switchId}>Show original colours</Label>
          </div>
        ) : null}
      </div>

      {starProblem ? (
        <Alert variant="danger">
          <AlertDescription>{starProblem}</AlertDescription>
        </Alert>
      ) : null}

      {presets.length === 0 ? (
        <EmptyState
          icon={noFavourites ? Star : Search}
          title={noFavourites ? 'No favourites yet' : 'No templates match'}
          description={
            noFavourites
              ? 'Star a template to keep it here for everyone in this workspace.'
              : 'Try another word or clear the filters.'
          }
          action={
            isFiltered(filter)
              ? { label: 'Clear Filters', onClick: () => setFilter(NO_FILTER) }
              : undefined
          }
        />
      ) : (
        <ul className={GRID} aria-busy={creating !== null}>
          {isFiltered(filter) ? null : (
            <li className="min-w-0">
              <button
                type="button"
                data-testid="start-from-blank"
                disabled={creating !== null}
                onClick={() => void create(BLANK_PRESET_ID)}
                className={cn(
                  'flex h-full w-full flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-outline bg-inset p-4 text-center',
                  FOCUS,
                  'disabled:cursor-wait disabled:opacity-60',
                )}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-outline bg-actionPrimary text-onActionPrimary">
                  <MotionIcon icon={PlusIcon} className="h-5 w-5" />
                </span>
                <span className="type-ui text-sm text-ink">
                  {creating === BLANK_PRESET_ID ? 'Creating…' : 'Start From Blank'}
                </span>
                <span className="max-w-48 font-sans text-xs text-ink type-muted">
                  One plain slide in the colours of your brand.
                </span>
              </button>
            </li>
          )}

          {presets.map((preset) => {
            const design = documents.get(preset.id);
            const starred = favourites.has(preset.id);
            const metaId = `template-${preset.id}-meta`;

            return (
              <li key={preset.id} className="relative min-w-0">
                <button
                  type="button"
                  data-testid="template-card"
                  aria-label={`Use ${preset.name}`}
                  aria-describedby={metaId}
                  // The ring alone shows the template already chosen; this says it.
                  aria-current={preset.id === presetId ? 'true' : undefined}
                  disabled={creating !== null}
                  onClick={() => void create(preset.id)}
                  className={cn(
                    'flex h-full w-full flex-col gap-3 rounded-card border-2 border-outline bg-secondary p-3 text-left',
                    pressSm,
                    FOCUS,
                    'disabled:cursor-wait',
                    preset.id === presetId && CHOSEN,
                  )}
                >
                  <span
                    className={cn(
                      INSET,
                      'flex aspect-square items-center justify-center bg-halftone p-4',
                    )}
                  >
                    <span
                      className="block border-2 border-outline shadow-brutalSm"
                      style={{ width }}
                    >
                      {design ? <SlideFrame design={design} resolveMedia={resolve} lazy /> : null}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5 pe-11">
                    <span
                      className="line-clamp-2 break-words type-ui text-sm text-ink"
                      title={preset.name}
                    >
                      {creating === preset.id ? 'Creating…' : preset.name}
                    </span>
                    <span id={metaId} className="font-sans text-xs text-ink type-muted">
                      {CATEGORY_LABELS[preset.category]}, {slideCountLabel(preset.slides.length)}
                    </span>
                  </span>
                </button>

                <Button
                  variant="secondary"
                  size="sm"
                  aria-pressed={starred}
                  aria-label={
                    starred
                      ? `Remove ${preset.name} from favourites`
                      : `Add ${preset.name} to favourites`
                  }
                  onClick={() => onStar(preset.id, !starred)}
                  className="absolute bottom-3 end-3 w-9 px-0"
                >
                  <MotionIcon
                    icon={StarIcon}
                    className={cn('h-4 w-4', starred && 'fill-current')}
                  />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={onBack} disabled={creating !== null}>
          <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
          Back
        </Button>
      </div>
    </section>
  );
}
