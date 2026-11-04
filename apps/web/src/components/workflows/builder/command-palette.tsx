'use client';

/**
 * The builder's command palette (Ctrl or Cmd+K; blueprint 4.6; after n8n's,
 * 2026-11-03), on the design system's Command list in the same frame as the top
 * bar's search: filter tabs under the input (All, Steps, Add, Commands), rows
 * with their icon and shortcut, and the keys to use along the bottom.
 */
import type { GraphNode } from '@postgear/automation';
import { getDefinition } from '@postgear/automation';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@postgear/ui';
import {
  Keyboard,
  ListChecks,
  type LucideIcon,
  PanelRight,
  Play,
  Rocket,
  Scan,
  StickyNote,
  WandSparkles,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { StepGlyph } from '../list/step-glyph';
import type { PickerItem } from '../picker/picker-search';
import { ShortcutKeys } from './shortcut-keys';

export type PaletteCommand =
  | 'test'
  | 'activate'
  | 'setup'
  | 'tidy'
  | 'addNote'
  | 'toggleSteps'
  | 'fit'
  | 'shortcuts';

const COMMANDS: readonly {
  id: PaletteCommand;
  label: string;
  icon: LucideIcon;
  keys?: string;
}[] = [
  { id: 'test', label: 'Test Workflow', icon: Play, keys: 'Ctrl+Enter' },
  { id: 'activate', label: 'Activate', icon: Rocket },
  { id: 'setup', label: 'Open Setup', icon: ListChecks },
  { id: 'toggleSteps', label: 'Show Steps', icon: PanelRight, keys: 'N' },
  { id: 'addNote', label: 'Add Note', icon: StickyNote, keys: 'Shift+S' },
  { id: 'tidy', label: 'Tidy Up', icon: WandSparkles },
  { id: 'fit', label: 'Fit To Screen', icon: Scan, keys: '1' },
  { id: 'shortcuts', label: 'Show Shortcuts', icon: Keyboard, keys: '?' },
];

type Filter = 'all' | 'steps' | 'add' | 'commands';

function Hint({ keys, words }: { keys: string; words: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <ShortcutKeys keys={keys.split('+')} />
      {words}
    </span>
  );
}

export function CommandPalette({
  open,
  onOpenChange,
  items,
  steps,
  onAddStep,
  onGoToStep,
  onCommand,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Addable picker items for the selected step. */
  items: PickerItem[];
  steps: GraphNode[];
  onAddStep: (item: PickerItem) => void;
  onGoToStep: (key: string) => void;
  onCommand: (command: PaletteCommand) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');

  // Each opening starts on everything.
  useEffect(() => {
    if (open) setFilter('all');
  }, [open]);

  function run(action: () => void) {
    onOpenChange(false);
    action();
  }
  const shows = (group: Filter) => filter === 'all' || filter === group;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl overflow-hidden p-0 shadow-surfaceLg">
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <DialogDescription className="sr-only">
          Add a step, go to a step or run a builder command. Use the arrow keys to move and Enter to
          run.
        </DialogDescription>
        <Command loop label="Builder commands" className="border-none shadow-none">
          <CommandInput placeholder="Enter your command or step name" />
          <Tabs
            value={filter}
            onValueChange={(value) => setFilter(value as Filter)}
            className="border-b-2 border-outline px-3 py-2"
          >
            <TabsList aria-label="Show">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="steps">Steps</TabsTrigger>
              <TabsTrigger value="add">Add</TabsTrigger>
              <TabsTrigger value="commands">Commands</TabsTrigger>
            </TabsList>
          </Tabs>
          <CommandList className="max-h-[min(24rem,60dvh)]">
            <CommandEmpty>Nothing matches that.</CommandEmpty>
            {shows('commands') ? (
              <CommandGroup heading="Commands">
                {COMMANDS.map(({ id, label, icon: Icon, keys }) => (
                  <CommandItem
                    key={id}
                    value={`command ${label}`}
                    onSelect={() => run(() => onCommand(id))}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
                    <span className="flex-1">{label}</span>
                    {keys ? <ShortcutKeys keys={keys.split('+')} /> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {shows('steps') && steps.length > 0 ? (
              <CommandGroup heading="Go To Step">
                {steps.map((step) => (
                  <CommandItem
                    key={step.key}
                    value={`go ${step.name} ${step.key}`}
                    onSelect={() => run(() => onGoToStep(step.key))}
                  >
                    <StepGlyph
                      icon={getDefinition(step.type, step.typeVersion)?.icon ?? 'manual'}
                      className="h-4 w-4"
                    />
                    {step.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {shows('add') ? (
              <CommandGroup heading="Add Step">
                {items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`add ${item.title} ${item.keywords.join(' ')}`}
                    onSelect={() => run(() => onAddStep(item))}
                  >
                    <StepGlyph icon={item.icon} className="h-4 w-4" />
                    {item.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
          <div className="flex items-center gap-4 border-t-2 border-outline px-3 py-2 font-sans text-xs text-ink type-muted">
            <Hint keys="Up+Down" words="to move" />
            <Hint keys="Enter" words="to run" />
            <Hint keys="Esc" words="to close" />
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
