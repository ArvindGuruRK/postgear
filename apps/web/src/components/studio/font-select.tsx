'use client';

/**
 * The Studio's font picker (Sprint 9b): the Design tab's Heading and Body,
 * the Element tab's Font and a brand kit's Fonts all use it.
 *
 * The families are grouped by category, and each is named in its own face so
 * the list doubles as a specimen. `StudioFonts` declares every face; a
 * browser downloads only the ones a list on screen uses, so the files arrive
 * when the list opens, not with the page. The first option stands for no
 * choice, and says what that means where the picker sits: "Theme Font" on a
 * design, "Design Font" on one element.
 */
import {
  FONT_CATEGORIES,
  FONT_CATEGORY_LABELS,
  FONT_IDS,
  type FontId,
  fontStack,
  fontsInCategory,
} from '@postgear/design-engine';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@postgear/ui';

/** The list's value for "no font chosen": Radix refuses an empty string. */
const NO_CHOICE = 'default';

function isFontId(value: string): value is FontId {
  return (FONT_IDS as readonly string[]).includes(value);
}

export function FontSelect({
  id,
  label,
  value,
  defaultLabel,
  only,
  disabled = false,
  className,
  onChange,
}: {
  /** For a `<label htmlFor>` beside the picker. */
  id?: string;
  /** The accessible name when no visible label points at `id`. */
  label?: string;
  value: FontId | null;
  /**
   * The first option, standing for null: "Theme Font", "Design Font". Left
   * out where a font is always chosen (a clip's text), so there is no first option.
   */
  defaultLabel?: string;
  /** Offer only these fonts (a clip's text: the ones the export has). Every font when left out. */
  only?: readonly FontId[];
  disabled?: boolean;
  className?: string;
  onChange: (value: FontId | null) => void;
}) {
  const offered = only ? new Set(only) : null;
  return (
    <Select
      value={value ?? NO_CHOICE}
      disabled={disabled}
      onValueChange={(next) => onChange(isFontId(next) ? next : null)}
    >
      <SelectTrigger id={id} aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {defaultLabel === undefined ? null : (
          <SelectItem value={NO_CHOICE}>{defaultLabel}</SelectItem>
        )}
        {FONT_CATEGORIES.map((category) => {
          const fonts = fontsInCategory(category).filter((font) => !offered || offered.has(font.id));
          if (fonts.length === 0) return null;
          return (
            <SelectGroup key={category}>
              <SelectLabel>{FONT_CATEGORY_LABELS[category]}</SelectLabel>
              {fonts.map((font) => (
                <SelectItem key={font.id} value={font.id}>
                  <span style={{ fontFamily: fontStack(font.id) }}>{font.label}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}
