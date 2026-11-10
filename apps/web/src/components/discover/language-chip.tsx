'use client';

/**
 * The language chip: the design system's `Select`, dressed as a chip beside
 * the place chip. It offers the place's languages that Google News has an
 * edition in (`newsLanguages`), most used first, each as its own name then
 * the English one ("தமிழ் Tamil"). The place's full list stays for the
 * Create Post sheet, where the AI can write in a language News cannot read.
 *
 * On a phone it shortens to the code ("ta").
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@postgear/ui';
import { languageLabel } from './language-names';

export function LanguageChip({
  languages,
  value,
  onChange,
  disabled,
}: {
  languages: readonly string[];
  value: string;
  onChange: (language: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        aria-label={`Language: ${languageLabel(value)}`}
        data-testid="discover-language-chip"
        className="h-10 w-auto min-w-0 max-w-full gap-2 rounded-lg bg-chrome px-3"
      >
        <SelectValue>
          <span className="hidden truncate sm:inline">{languageLabel(value)}</span>
          <span className="sm:hidden">{value}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        {languages.map((code) => (
          <SelectItem key={code} value={code}>
            {languageLabel(code)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
