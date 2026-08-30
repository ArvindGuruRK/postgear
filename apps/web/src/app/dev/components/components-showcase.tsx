'use client';

import { AppShell } from '@/components/navigation/app-shell';
import type { SidebarItem } from '@/components/navigation/sidebar';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
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
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Toggle,
  useToast,
} from '@postgear/ui';
import {
  BarChart3,
  Calendar,
  LayoutGrid,
  MoreVertical,
  Palette,
  Search,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';

const NAV_ITEMS: SidebarItem[] = [
  { label: 'Dashboard', href: '#dashboard', icon: LayoutGrid },
  { label: 'Calendar', href: '#calendar', icon: Calendar },
  { label: 'Analytics', href: '#analytics', icon: BarChart3 },
  { label: 'SEO', href: '#seo', icon: Search },
  { label: 'Team', href: '#team', icon: Users },
  { label: 'Design System', href: '/dev/components', icon: Palette, active: true },
  { label: 'Settings', href: '#settings', icon: Settings },
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-3xl tracking-wide text-ink">{title}</h2>
        <p className="mt-1 max-w-2xl font-sans text-sm text-ink opacity-70">{description}</p>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-6 pt-6">{children}</CardContent>
      </Card>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="font-sans text-sm font-bold text-ink">{label}</span>
      <div className="flex flex-wrap items-center gap-4">{children}</div>
    </div>
  );
}

export function ComponentsShowcase() {
  const { toast } = useToast();
  const [checked, setChecked] = useState(true);
  const [toggled, setToggled] = useState(true);

  return (
    <AppShell navItems={NAV_ITEMS} pageTitle="Design System">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 pb-16">
        <div>
          <h1 className="font-display text-4xl tracking-wide text-ink">Component Playground</h1>
          <p className="mt-2 max-w-2xl font-sans text-sm text-ink opacity-70">
            Every primitive in <code>@postgear/ui</code>, every variant, every state — light and
            dark. Flip the theme toggle in the top bar to check parity. Dev-only: excluded from
            production builds.
          </p>
        </div>

        <Section
          title="Buttons"
          description="The reference press interaction: shadow-brutalMd collapses to shadow-brutalPressed on click."
        >
          <Row label="Primary">
            <Button size="sm">Connect Channel</Button>
            <Button size="md">Connect Channel</Button>
            <Button size="lg">Connect Channel</Button>
            <Button disabled>Disabled</Button>
          </Row>
          <Row label="Secondary">
            <Button variant="secondary">Schedule Post</Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
          </Row>
          <Row label="Danger">
            <Button variant="danger">Delete</Button>
            <Button variant="danger" disabled>
              Disabled
            </Button>
          </Row>
          <Row label="AI">
            <Button variant="ai">
              <Sparkles className="h-4 w-4" strokeWidth={2.5} />
              Ask AI
            </Button>
            <Button variant="ai" disabled>
              Disabled
            </Button>
          </Row>
        </Section>

        <Section title="Badges" description="The sticker exception to the sharp-corner rule.">
          <Row label="Variants">
            <Badge variant="primary">Primary</Badge>
            <Badge variant="secondary">Live</Badge>
            <Badge variant="danger">Past due</Badge>
            <Badge variant="ai">AI Powered</Badge>
            <Badge variant="accent">New</Badge>
            <Badge variant="outline">Draft</Badge>
          </Row>
        </Section>

        <Section
          title="Form Controls"
          description="Thick border, flat surface, one shared focus ring across Input, Select, Checkbox, and Toggle."
        >
          <Row label="Input">
            <Input placeholder="Channel name" className="w-56" />
            <Input placeholder="Error state" variant="error" className="w-56" />
            <Input placeholder="Disabled" disabled className="w-56" />
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
          <Row label="Toggle">
            <Toggle
              checked={toggled}
              onCheckedChange={setToggled}
              aria-label="Enable notifications"
            />
            <Toggle disabled aria-label="Disabled toggle" />
          </Row>
        </Section>

        <Section
          title="Avatars"
          description="Sticker treatment — always rounded-full, always a thick ink border."
        >
          <Row label="Sizes">
            <Avatar size="sm">
              <AvatarImage src="https://i.pravatar.cc/64?img=12" alt="" />
              <AvatarFallback>AK</AvatarFallback>
            </Avatar>
            <Avatar size="md">
              <AvatarImage src="https://i.pravatar.cc/64?img=13" alt="" />
              <AvatarFallback>JM</AvatarFallback>
            </Avatar>
            <Avatar size="lg">
              <AvatarFallback>PG</AvatarFallback>
            </Avatar>
          </Row>
        </Section>

        <Section
          title="Cards"
          description="The workhorse container — Sprint 4/3/7 all reuse this instead of inventing their own bordered box."
        >
          <Card className="max-w-sm">
            <CardHeader>
              <CardTitle>Analytics Overview</CardTitle>
              <CardDescription>Last 7 days across all connected channels</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="font-sans text-sm text-ink">
                Engagement is up 24% this week. Your AI-drafted captions are outperforming manual
                posts by 3x.
              </p>
            </CardContent>
            <CardFooter>
              <Button size="sm">View Report</Button>
              <Button size="sm" variant="secondary">
                Export
              </Button>
            </CardFooter>
          </Card>
        </Section>

        <Section
          title="Dialogs & Overlays"
          description="Flat ink-tinted backdrop, no blur — large-surface treatment (border-4, shadow-brutalLg)."
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
                    This removes LinkedIn — Acme Media from PostGear. Scheduled posts for this
                    channel will be cancelled. This can't be undone.
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
          <Row label="Dropdown menu">
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
        </Section>

        <Section
          title="Toasts"
          description="Queued, auto-dismissing, three tones matched to the action palette."
        >
          <Row label="Fire a toast">
            <Button
              size="sm"
              onClick={() =>
                toast({ title: 'Post scheduled', description: 'Goes live tomorrow at 9:00 AM.' })
              }
            >
              Default
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                toast({
                  variant: 'danger',
                  title: 'Publish failed',
                  description: 'LinkedIn rejected the request — token expired.',
                })
              }
            >
              Danger
            </Button>
            <Button
              size="sm"
              variant="ai"
              onClick={() =>
                toast({
                  variant: 'ai',
                  title: 'AI caption ready',
                  description: 'Review it before it goes live.',
                })
              }
            >
              AI
            </Button>
          </Row>
        </Section>
      </div>
    </AppShell>
  );
}
