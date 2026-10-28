'use client';

/**
 * The template filters the gallery (Create Design, step 3) and the template
 * playground (`/dev/studio`) share, so both offer the same choices in the
 * same words (Sprint 9b, section 13): Category, Collection, Style, Look and
 * Colour. Search and Favourites stay with each screen, which lays them out
 * its own way.
 *
 * Each is a Select named by its `aria-label`; its "All ..." choice says what
 * it filters, so it needs no label above it. The value handed back has been
 * read by the view model's parser already. The choices come from the library
 * itself (`lookGroups`, `familyOptions`, `collectionOptions`), so a look no
 * template wears is never offered.
 */
import {
  CATEGORY_LABELS,
  COLLECTION_LABELS,
  type ColorFamily,
  LOOK_NONE,
  PRESET_CATEGORIES,
  type PresetCategory,
  type PresetCollection,
  type ThemeStyle,
} from '@postgear/design-engine';
import {
  cn,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@postgear/ui';
import {
  ALL,
  collectionOptions,
  familyLabel,
  familyOptions,
  hasNoArtTemplates,
  lookGroups,
  NO_ART_LABEL,
  parseCategory,
  parseCollection,
  parseFamily,
  parseLook,
  parseStyle,
  STYLE_LABELS,
} from './studio-view-model';

/**
 * A long choice ("All Collections") is cut with an ellipsis rather than
 * pushing the field past its cell on a phone; the menu shows it whole.
 */
const TRIGGER = 'min-w-0 [&>span]:min-w-0 [&>span]:truncate';

// The library is code, so its choices are worked out once, not per render.
const LOOK_GROUPS = lookGroups();
const NONE_OFFERED = hasNoArtTemplates();
const FAMILIES = familyOptions();
const COLLECTIONS = collectionOptions();
const STYLES = Object.keys(STYLE_LABELS) as ThemeStyle[];

interface FilterProps<T> {
  value: T;
  onChange: (value: T) => void;
  /** For the trigger: its width in the screen's own layout, `shadow-none` inside a panel. */
  className?: string;
}

export function CategoryFilter({
  value,
  onChange,
  className,
}: FilterProps<PresetCategory | typeof ALL>) {
  return (
    <Select value={value} onValueChange={(next) => onChange(parseCategory(next))}>
      <SelectTrigger aria-label="Filter by category" className={cn(TRIGGER, className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All Categories</SelectItem>
        {PRESET_CATEGORIES.map((category) => (
          <SelectItem key={category} value={category}>
            {CATEGORY_LABELS[category]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CollectionFilter({
  value,
  onChange,
  className,
}: FilterProps<PresetCollection | typeof ALL>) {
  return (
    <Select value={value} onValueChange={(next) => onChange(parseCollection(next))}>
      <SelectTrigger aria-label="Filter by collection" className={cn(TRIGGER, className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All Collections</SelectItem>
        {COLLECTIONS.map((collection) => (
          <SelectItem key={collection} value={collection}>
            {COLLECTION_LABELS[collection]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function StyleFilter({ value, onChange, className }: FilterProps<ThemeStyle | typeof ALL>) {
  return (
    <Select value={value} onValueChange={(next) => onChange(parseStyle(next))}>
      <SelectTrigger aria-label="Filter by style" className={cn(TRIGGER, className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All Styles</SelectItem>
        {STYLES.map((style) => (
          <SelectItem key={style} value={style}>
            {STYLE_LABELS[style]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The background art (Sprint 9b's Look): None, then every style a template
 * wears under its kind's heading (Patterns, Hand-Made, Luxury), since thirty
 * names in one run are hard to scan. The menu scrolls inside itself.
 */
export function LookFilter({ value, onChange, className }: FilterProps<string>) {
  return (
    <Select value={value} onValueChange={(next) => onChange(parseLook(next))}>
      <SelectTrigger aria-label="Filter by look" className={cn(TRIGGER, className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-[var(--radix-select-content-available-height)]">
        <SelectItem value={ALL}>All Looks</SelectItem>
        {NONE_OFFERED ? <SelectItem value={LOOK_NONE}>{NO_ART_LABEL}</SelectItem> : null}
        {LOOK_GROUPS.map((group) => (
          <SelectGroup key={group.kind}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.looks.map((look) => (
              <SelectItem key={look.id} value={look.id}>
                {look.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The colour family of the template's theme. */
export function ColourFilter({
  value,
  onChange,
  className,
}: FilterProps<ColorFamily | typeof ALL>) {
  return (
    <Select value={value} onValueChange={(next) => onChange(parseFamily(next))}>
      <SelectTrigger aria-label="Filter by colour" className={cn(TRIGGER, className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All Colours</SelectItem>
        {FAMILIES.map((family) => (
          <SelectItem key={family} value={family}>
            {familyLabel(family)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
