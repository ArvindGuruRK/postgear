'use client';

/**
 * The builder's command palette (Ctrl or Cmd+K; blueprint 4.6), on the
 * design system's Command list in the same frame as the top bar's search:
 * Add Step (the picker's items inline), Go To Step, Tidy Up, Add Note,
 * Toggle Steps Panel, Fit To Screen and Show Shortcuts.
 */
import type { GraphNode } from '@postgear/automation';
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
} from '@postgear/ui';
import { AppIcon } from '../app-icon';
import type { PickerItem } from '../picker/picker-search';

export type PaletteCommand = 'tidy' | 'addNote' | 'toggleSteps' | 'fit' | 'shortcuts';

const COMMANDS: readonly { id: PaletteCommand; label: string }[] = [
  { id: 'tidy', label: 'Tidy Up' },
  { id: 'addNote', label: 'Add Note' },
  { id: 'toggleSteps', label: 'Toggle Steps Panel' },
  { id: 'fit', label: 'Fit To Screen' },
  { id: 'shortcuts', label: 'Show Shortcuts' },
];

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
  function run(action: () => void) {
    onOpenChange(false);
    action();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-surfaceLg">
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <DialogDescription className="sr-only">
          Add a step, go to a step or run a builder command. Use the arrow keys to move and Enter to
          run.
        </DialogDescription>
        <Command loop label="Builder commands" className="border-none shadow-none">
          <CommandInput placeholder="Enter your command or step name" />
          <CommandList className="max-h-[min(24rem,60dvh)]">
            <CommandEmpty>Nothing matches that.</CommandEmpty>
            <CommandGroup heading="Commands">
              {COMMANDS.map((command) => (
                <CommandItem
                  key={command.id}
                  value={`command ${command.label}`}
                  onSelect={() => run(() => onCommand(command.id))}
                >
                  {command.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {steps.length > 0 ? (
              <CommandGroup heading="Go To Step">
                {steps.map((step) => (
                  <CommandItem
                    key={step.key}
                    value={`go ${step.name} ${step.key}`}
                    onSelect={() => run(() => onGoToStep(step.key))}
                  >
                    {step.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandGroup heading="Add Step">
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`add ${item.title} ${item.keywords.join(' ')}`}
                  onSelect={() => run(() => onAddStep(item))}
                >
                  <AppIcon icon={item.icon} />
                  {item.title}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
