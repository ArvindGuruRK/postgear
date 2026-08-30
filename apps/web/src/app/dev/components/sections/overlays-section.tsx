'use client';

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
  TooltipProvider,
  TooltipTrigger,
} from '@postgear/ui';
import { MoreVertical } from 'lucide-react';
import { Row, Section } from '../shared';

export function OverlaysSection() {
  return (
    <Section
      title="Overlays"
      description="Flat ink-tinted backdrop, no blur — large-surface treatment (border-4, shadow-brutalLg) on every modal surface."
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
                This removes LinkedIn — Acme Media from PostGear. Scheduled posts for this channel will be
                cancelled. This can&apos;t be undone.
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
              <MoreVertical className="h-4 w-4" strokeWidth={2.5} />
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
            <p className="font-display text-sm uppercase tracking-wide text-ink">Post title</p>
            <p className="mt-1 font-sans text-sm text-ink opacity-70">
              Edit the caption without leaving this view.
            </p>
          </PopoverContent>
        </Popover>
      </Row>
      <Row label="Tooltip">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="secondary">Hover me</Button>
            </TooltipTrigger>
            <TooltipContent>Publishes immediately to all connected channels.</TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
            <p className="font-display text-sm uppercase tracking-wide text-ink">Jordan Miles</p>
            <p className="mt-1 font-sans text-sm text-ink opacity-70">
              Content lead — connected 4 channels, 128 posts scheduled this quarter.
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
