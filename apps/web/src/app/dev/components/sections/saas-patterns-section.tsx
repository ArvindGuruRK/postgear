'use client';

import {
  ActivityFeed,
  BulkActionBar,
  Button,
  FilterBar,
  NotificationCenter,
  OnboardingStepper,
  PageHeader,
  PlanCard,
  SectionHeader,
  SettingsNav,
  SortControl,
  Toolbar,
  UsageMeter,
  UserMenu,
  ViewSwitcher,
  WorkspaceSwitcher,
} from '@postgear/ui';
import { Grid3x3, LayoutList, LogOut, Settings, User } from 'lucide-react';
import { useState } from 'react';
import { Row, Section } from '../shared';

const DEMO_WORKSPACES = [
  { id: '1', name: 'Acme Media' },
  { id: '2', name: 'Nova Studio' },
];

const DEMO_NOTIFICATIONS = [
  { id: '1', title: 'Post published', description: 'Q3 recap went live on LinkedIn.', timestamp: '2h ago', read: false },
  { id: '2', title: 'Channel reconnected', description: 'TikTok token refreshed.', timestamp: 'Yesterday', read: true },
];

const DEMO_ACTIVITY = [
  { id: '1', title: 'Post published', description: 'Q3 product recap on LinkedIn', timestamp: '2 hours ago' },
  { id: '2', title: 'Channel connected', description: 'TikTok linked to this workspace', timestamp: 'Yesterday' },
  { id: '3', title: 'Workspace created', timestamp: '3 days ago' },
];

const DEMO_SETTINGS_ITEMS = [
  { label: 'Profile', href: '#profile', icon: User },
  { label: 'Notifications', href: '#notifications' },
  { label: 'Billing', href: '#billing' },
];

const ONBOARDING_STEPS = [
  { label: 'Account', description: 'Create your account' },
  { label: 'Workspace', description: 'Name your workspace' },
  { label: 'Connect', description: 'Link a channel' },
  { label: 'Launch', description: 'Schedule your first post' },
];

export function SaasPatternsSection() {
  const [workspaceId, setWorkspaceId] = useState('1');
  const [filters, setFilters] = useState([
    { id: 'channel', label: 'Channel: LinkedIn' },
    { id: 'status', label: 'Status: Scheduled' },
  ]);
  const [sortValue, setSortValue] = useState('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [view, setView] = useState('grid');
  const [selectedCount, setSelectedCount] = useState(3);

  return (
    <Section
      title="SaaS Patterns"
      description="Composite patterns built entirely from the primitives above — the pieces every product screen in PostGear reuses."
    >
      <Row label="Page Header">
        <div className="w-full">
          <PageHeader
            title="Content Calendar"
            description="Every scheduled post across every connected channel."
            actions={<Button size="sm">New Post</Button>}
          />
        </div>
      </Row>
      <Row label="Section Header">
        <div className="w-full">
          <SectionHeader
            title="Upcoming posts"
            description="Next 7 days"
            actions={
              <Button size="sm" variant="secondary">
                View all
              </Button>
            }
          />
        </div>
      </Row>
      <Row label="Toolbar + Filter Bar + Sort + View Switcher">
        <div className="flex w-full flex-col gap-3">
          <Toolbar
            start={<span className="font-sans text-sm text-ink opacity-70">5 posts</span>}
            end={
              <>
                <SortControl
                  options={[
                    { value: 'date', label: 'Date' },
                    { value: 'engagement', label: 'Engagement' },
                  ]}
                  value={sortValue}
                  onValueChange={setSortValue}
                  direction={sortDirection}
                  onDirectionChange={setSortDirection}
                />
                <ViewSwitcher
                  options={[
                    { value: 'grid', label: 'Grid view', icon: Grid3x3 },
                    { value: 'list', label: 'List view', icon: LayoutList },
                  ]}
                  value={view}
                  onValueChange={setView}
                />
              </>
            }
          />
          <FilterBar
            filters={filters}
            onRemove={(id) => setFilters((prev) => prev.filter((f) => f.id !== id))}
            onClearAll={() => setFilters([])}
          />
        </div>
      </Row>
      <Row label="Bulk Action Bar">
        <div className="flex w-full flex-col gap-3">
          <BulkActionBar
            count={selectedCount}
            onClear={() => setSelectedCount(0)}
            actions={
              <>
                <Button size="sm" variant="secondary">
                  Duplicate
                </Button>
                <Button size="sm" variant="danger">
                  Delete
                </Button>
              </>
            }
          />
          {selectedCount === 0 && (
            <Button size="sm" variant="secondary" onClick={() => setSelectedCount(3)} className="w-fit">
              Re-select 3 posts
            </Button>
          )}
        </div>
      </Row>
      <Row label="Workspace Switcher">
        <WorkspaceSwitcher
          workspaces={DEMO_WORKSPACES}
          activeId={workspaceId}
          onActiveChange={setWorkspaceId}
          onCreate={() => {}}
        />
      </Row>
      <Row label="User Menu">
        <UserMenu
          name="Jordan Miles"
          email="jordan@acmemedia.com"
          items={[
            { label: 'Profile', icon: User },
            { label: 'Settings', icon: Settings },
            { label: 'Log out', icon: LogOut, danger: true },
          ]}
        />
      </Row>
      <Row label="Notification Center">
        <NotificationCenter notifications={DEMO_NOTIFICATIONS} />
      </Row>
      <Row label="Activity Feed">
        <ActivityFeed items={DEMO_ACTIVITY} className="w-80" />
      </Row>
      <Row label="Plan / Pricing Card">
        <PlanCard
          name="Starter"
          price="$0"
          description="For solo creators"
          features={['3 connected channels', '10 scheduled posts/mo', 'Basic analytics']}
          actionLabel="Current plan"
          actionVariant="secondary"
        />
        <PlanCard
          name="Growth"
          price="$29"
          description="For growing teams"
          badge="Popular"
          highlighted
          features={['Unlimited channels', 'Unlimited scheduling', 'AI captions', 'Team seats']}
        />
      </Row>
      <Row label="Usage Meter">
        <div className="flex w-64 flex-col gap-4">
          <UsageMeter label="Scheduled posts" value={82} max={100} />
          <UsageMeter label="AI credits" value={950} max={1000} unit="credits" />
        </div>
      </Row>
      <Row label="Settings Navigation">
        <SettingsNav items={DEMO_SETTINGS_ITEMS} activeHref="#profile" className="w-48" />
      </Row>
      <Row label="Onboarding Stepper">
        <div className="w-full max-w-lg">
          <OnboardingStepper steps={ONBOARDING_STEPS} currentStep={2} />
        </div>
      </Row>
    </Section>
  );
}
