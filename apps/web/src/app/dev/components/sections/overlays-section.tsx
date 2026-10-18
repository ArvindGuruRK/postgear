'use client';

import { EllipsisVerticalIcon } from '@animateicons/react/lucide/ellipsis-vertical-icon';
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Avatar,
  AvatarFallback,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Kbd,
  KbdGroup,
  MotionIcon,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Tooltip,
  TooltipContent,
  TooltipHint,
  TooltipTrigger,
} from '@postgear/ui';
import { Row, Section } from '../shared';

export function OverlaysSection() {
  return (
    <Section
      title="Overlays"
      description="Flat ink-tinted backdrop, no blur: every modal surface uses border-2 and the bottom-only shadow-surfaceLg."
    >
      <Row label="Dialog">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="danger">Delete Channel</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this channel?</DialogTitle>
              <DialogDescription>
                This removes LinkedIn (Acme Media) from PostGear. Scheduled posts for this channel
                will be cancelled. This can&apos;t be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="danger">Delete</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Row>
      <Row label="Alert Dialog (destructive confirmation)">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="danger">Remove Team Member</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this team member?</AlertDialogTitle>
              <AlertDialogDescription>
                They&apos;ll lose access to this workspace immediately. This can&apos;t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Row>
      <Row label="Dropdown Menu">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">
              <MotionIcon icon={EllipsisVerticalIcon} className="h-4 w-4" />
              Actions
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Post actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Duplicate</DropdownMenuItem>
            <DropdownMenuItem>Reschedule</DropdownMenuItem>
            <DropdownMenuItem>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Row>
      <Row label="Popover">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">Quick edit</Button>
          </PopoverTrigger>
          <PopoverContent>
            <p className="type-label text-sm text-ink">Post title</p>
            <p className="mt-1 font-sans text-sm text-ink opacity-70">
              Edit the caption without leaving this view.
            </p>
          </PopoverContent>
        </Popover>
      </Row>
      <Row label="Tooltip">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="secondary">Hover me</Button>
          </TooltipTrigger>
          <TooltipContent>Publishes immediately to all connected channels.</TooltipContent>
        </Tooltip>
      </Row>
      <Row label="Tooltip: sides">
        {(['left', 'top', 'bottom', 'right'] as const).map((side) => (
          <TooltipHint key={side} label={`Opens ${side}`} side={side}>
            <Button variant="secondary" size="sm" className="capitalize">
              {side}
            </Button>
          </TooltipHint>
        ))}
      </Row>
      <Row label="Tooltip: keyboard shortcut, icon button, disabled">
        <TooltipHint
          label="Search"
          shortcut={
            <KbdGroup>
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          }
        >
          <Button variant="secondary" size="sm">
            Search
          </Button>
        </TooltipHint>
        <TooltipHint label="Generate with AI">
          <Button variant="ai" size="sm" className="w-9 px-0" aria-label="Generate with AI">
            <MotionIcon icon={SparklesIcon} className="h-4 w-4" />
          </Button>
        </TooltipHint>
        <TooltipHint label="This plan’s channel limit is reached" disabled>
          <Button size="sm" disabled>
            Add Channel
          </Button>
        </TooltipHint>
      </Row>
      <Row label="Kbd">
        <p className="flex items-center gap-2 font-sans text-sm text-ink">
          Press
          <KbdGroup>
            <Kbd>Shift</Kbd>
            <Kbd>?</Kbd>
          </KbdGroup>
          for shortcuts
        </p>
      </Row>
      <Row label="Hover Card">
        <HoverCard>
          <HoverCardTrigger asChild>
            <span className="inline-flex cursor-pointer items-center gap-2 font-sans text-sm font-semibold text-ink underline underline-offset-2">
              <Avatar size="sm">
                <AvatarFallback>JM</AvatarFallback>
              </Avatar>
              @jordan
            </span>
          </HoverCardTrigger>
          <HoverCardContent>
            <p className="type-label text-sm text-ink">Jordan Miles</p>
            <p className="mt-1 font-sans text-sm text-ink opacity-70">
              Content lead. Connected 4 channels, 128 posts scheduled this quarter.
            </p>
          </HoverCardContent>
        </HoverCard>
      </Row>
      <Row label="Sheet (slide-in drawer)">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="secondary">Open Sheet</Button>
          </SheetTrigger>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Post settings</SheetTitle>
              <SheetDescription>Configure where and when this post goes live.</SheetDescription>
            </SheetHeader>
            <SheetFooter>
              <SheetClose asChild>
                <Button variant="secondary">Close</Button>
              </SheetClose>
              <SheetClose asChild>
                <Button>Save</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </Row>
    </Section>
  );
}
