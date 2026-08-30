'use client';

import {
  Checkbox,
  Combobox,
  type ComboboxOption,
  DatePicker,
  DateRangePicker,
  FileUpload,
  FormErrorMessage,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  MultiSelect,
  type MultiSelectOption,
  RadioGroup,
  RadioGroupItem,
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Textarea,
  Toggle,
} from '@postgear/ui';
import type { DateRange } from 'react-day-picker';
import { useState } from 'react';
import { Row, Section } from '../shared';

const PLATFORM_OPTIONS: ComboboxOption[] = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'x', label: 'X (Twitter)' },
];

export function FormControlsSection() {
  const [checked, setChecked] = useState(true);
  const [toggled, setToggled] = useState(true);
  const [radioValue, setRadioValue] = useState('draft');
  const [search, setSearch] = useState('');
  const [sliderValue, setSliderValue] = useState([40]);
  const [rangeValue, setRangeValue] = useState([20, 70]);
  const [comboValue, setComboValue] = useState('linkedin');
  const [multiValue, setMultiValue] = useState<string[]>(['linkedin', 'tiktok']);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  const multiOptions: MultiSelectOption[] = PLATFORM_OPTIONS;

  return (
    <Section
      title="Form Controls"
      description="Thick border, flat surface, one shared focus ring across every control in this section."
    >
      <Row label="Input">
        <Input placeholder="Channel name" className="w-56" />
        <Input placeholder="Error state" variant="error" className="w-56" />
        <Input placeholder="Disabled" disabled className="w-56" />
      </Row>
      <Row label="Textarea">
        <Textarea placeholder="Post caption…" className="w-64" rows={3} />
        <Textarea placeholder="Error state" variant="error" className="w-64" rows={3} />
      </Row>
      <Row label="Search Input">
        <SearchInput
          placeholder="Search posts…"
          className="w-64"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onClear={() => setSearch('')}
        />
      </Row>
      <Row label="Select">
        <Select defaultValue="linkedin">
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Choose a platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="linkedin">LinkedIn</SelectItem>
            <SelectItem value="instagram">Instagram</SelectItem>
            <SelectItem value="tiktok">TikTok</SelectItem>
            <SelectItem value="youtube">YouTube</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row label="Combobox">
        <Combobox
          options={PLATFORM_OPTIONS}
          value={comboValue}
          onValueChange={setComboValue}
          className="w-56"
        />
      </Row>
      <Row label="Multi Select">
        <MultiSelect
          options={multiOptions}
          value={multiValue}
          onValueChange={setMultiValue}
          className="w-72"
        />
      </Row>
      <Row label="Checkbox">
        <span className="flex items-center gap-2 font-sans text-sm text-ink">
          <Checkbox
            checked={checked}
            onCheckedChange={(v) => setChecked(v === true)}
            aria-label="Auto-publish approved posts"
          />
          Auto-publish approved posts
        </span>
        <Checkbox checked="indeterminate" />
        <Checkbox disabled />
      </Row>
      <Row label="Radio Group">
        <RadioGroup value={radioValue} onValueChange={setRadioValue} className="flex-row gap-4">
          <span className="flex items-center gap-2 font-sans text-sm text-ink">
            <RadioGroupItem value="draft" id="radio-draft" />
            <label htmlFor="radio-draft">Draft</label>
          </span>
          <span className="flex items-center gap-2 font-sans text-sm text-ink">
            <RadioGroupItem value="scheduled" id="radio-scheduled" />
            <label htmlFor="radio-scheduled">Scheduled</label>
          </span>
          <span className="flex items-center gap-2 font-sans text-sm text-ink opacity-50">
            <RadioGroupItem value="archived" id="radio-archived" disabled />
            <label htmlFor="radio-archived">Archived</label>
          </span>
        </RadioGroup>
      </Row>
      <Row label="Toggle">
        <Toggle checked={toggled} onCheckedChange={setToggled} aria-label="Enable notifications" />
        <Toggle disabled aria-label="Disabled toggle" />
      </Row>
      <Row label="Slider">
        <div className="flex w-56 flex-col gap-6">
          <Slider value={sliderValue} onValueChange={setSliderValue} max={100} step={1} />
          <Slider value={rangeValue} onValueChange={setRangeValue} max={100} step={1} />
        </div>
      </Row>
      <Row label="Date Picker">
        <DatePicker value={date} onValueChange={setDate} className="w-56" />
      </Row>
      <Row label="Date Range Picker">
        <DateRangePicker value={dateRange} onValueChange={setDateRange} className="w-64" />
      </Row>
      <Row label="File Upload">
        <FileUpload
          className="w-80"
          helperText="PNG, JPG, or MP4 up to 50MB"
          onFilesSelected={() => {}}
        />
      </Row>
      <Row label="Form Field (label + helper/error text)">
        <FormField className="w-64">
          <FormLabel htmlFor="form-field-demo" required>
            Channel name
          </FormLabel>
          <Input id="form-field-demo" placeholder="Acme Media" />
          <FormHelperText>Shown to your audience on connected posts.</FormHelperText>
        </FormField>
        <FormField className="w-64">
          <FormLabel htmlFor="form-field-demo-error" required>
            API key
          </FormLabel>
          <Input id="form-field-demo-error" variant="error" defaultValue="invalid-key" />
          <FormErrorMessage>This key was rejected by LinkedIn.</FormErrorMessage>
        </FormField>
      </Row>
    </Section>
  );
}
