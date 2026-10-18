'use client';

import { CalendarIcon } from '@animateicons/react/lucide/calendar-icon';
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import { PencilIcon } from '@animateicons/react/lucide/pencil-icon';
import { SearchIcon } from '@animateicons/react/lucide/search-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  MotionIcon,
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  Pagination,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@postgear/ui';
import { useState } from 'react';
import { Row, Section } from '../shared';

export function NavigationSection() {
  const [page, setPage] = useState(4);
  const [commandOpen, setCommandOpen] = useState(false);

  return (
    <Section
      title="Navigation"
      description="Tabs, breadcrumbs, pagination, mega-menus, the command palette, and right-click context menus."
    >
      <Row label="Tabs">
        <Tabs defaultValue="posts" className="w-full max-w-md">
          <TabsList>
            <TabsTrigger value="posts">Posts</TabsTrigger>
            <TabsTrigger value="drafts">Drafts</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
          <TabsContent value="posts">Published posts across all channels.</TabsContent>
          <TabsContent value="drafts">Drafts waiting for review.</TabsContent>
          <TabsContent value="archived">Archived and cancelled posts.</TabsContent>
        </Tabs>
      </Row>
      <Row label="Breadcrumb">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#">Workspace</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="#">Channels</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>LinkedIn</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </Row>
      <Row label="Pagination">
        <Pagination page={page} pageCount={12} onPageChange={setPage} />
      </Row>
      <Row label="Navigation Menu">
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger>Product</NavigationMenuTrigger>
              <NavigationMenuContent>
                <div className="flex flex-col">
                  <NavigationMenuLink href="#">Calendar</NavigationMenuLink>
                  <NavigationMenuLink href="#">Analytics</NavigationMenuLink>
                  <NavigationMenuLink href="#">SEO Analyzer</NavigationMenuLink>
                </div>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      </Row>
      <Row label="Command Menu / Palette">
        <Button variant="secondary" onClick={() => setCommandOpen(true)}>
          <MotionIcon icon={SearchIcon} className="h-4 w-4" />
          Search commands…
        </Button>
        <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
          <CommandInput placeholder="Type a command…" />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Actions">
              <CommandItem onSelect={() => setCommandOpen(false)}>
                <MotionIcon icon={CalendarIcon} className="h-4 w-4" />
                Schedule a post
              </CommandItem>
              <CommandItem onSelect={() => setCommandOpen(false)}>
                <MotionIcon icon={PencilIcon} className="h-4 w-4" />
                Edit draft
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      </Row>
      <Row label="Context Menu (right-click)">
        <ContextMenu>
          <ContextMenuTrigger className="flex h-24 w-56 items-center justify-center rounded-md border-2 border-dashed border-outline font-sans text-sm text-ink opacity-70">
            Right-click this card
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem className="gap-2">
              <MotionIcon icon={CopyIcon} className="h-4 w-4" />
              Duplicate
            </ContextMenuItem>
            <ContextMenuItem className="gap-2 text-actionDanger">
              <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Row>
    </Section>
  );
}
