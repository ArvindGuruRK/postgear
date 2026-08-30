'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DataTable,
  List,
  ListItem,
  StatCard,
  StatusIndicator,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Timeline,
  TimelineDescription,
  TimelineItem,
  TimelineTimestamp,
  TimelineTitle,
} from '@postgear/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { BarChart3, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';
import { Row, Section } from '../shared';

interface DemoPost {
  id: string;
  title: string;
  channel: string;
  status: 'Published' | 'Scheduled' | 'Draft';
  engagement: number;
}

const DEMO_POSTS: DemoPost[] = [
  { id: '1', title: 'Q3 product recap', channel: 'LinkedIn', status: 'Published', engagement: 482 },
  { id: '2', title: 'Behind the scenes reel', channel: 'Instagram', status: 'Scheduled', engagement: 129 },
  { id: '3', title: 'Customer spotlight', channel: 'TikTok', status: 'Draft', engagement: 0 },
  { id: '4', title: 'Feature announcement', channel: 'YouTube', status: 'Published', engagement: 1204 },
  { id: '5', title: 'Weekly tips thread', channel: 'X', status: 'Scheduled', engagement: 76 },
];

const POST_COLUMNS: ColumnDef<DemoPost>[] = [
  { accessorKey: 'title', header: 'Title' },
  { accessorKey: 'channel', header: 'Channel' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => <Badge variant={row.original.status === 'Published' ? 'primary' : 'outline'}>{row.original.status}</Badge>,
  },
  { accessorKey: 'engagement', header: 'Engagement' },
];

export function DataDisplaySection() {
  const [collapsibleOpen, setCollapsibleOpen] = useState(false);

  return (
    <Section
      title="Data Display"
      description="Tables, stats, timelines, and collapsible content — restrained per the dense-data-surface rule: thick borders and flat color, no comic accents."
    >
      <Row label="Avatars">
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
      <Row label="Avatar Group">
        <AvatarGroup max={3}>
          <Avatar size="sm">
            <AvatarFallback>AK</AvatarFallback>
          </Avatar>
          <Avatar size="sm">
            <AvatarFallback>JM</AvatarFallback>
          </Avatar>
          <Avatar size="sm">
            <AvatarFallback>RS</AvatarFallback>
          </Avatar>
          <Avatar size="sm">
            <AvatarFallback>TL</AvatarFallback>
          </Avatar>
          <Avatar size="sm">
            <AvatarFallback>MP</AvatarFallback>
          </Avatar>
        </AvatarGroup>
      </Row>
      <Row label="Status Indicator">
        <StatusIndicator status="online" label="Online" />
        <StatusIndicator status="busy" label="Busy" />
        <StatusIndicator status="away" label="Away" />
        <StatusIndicator status="pending" label="Pending" />
        <StatusIndicator status="offline" label="Offline" />
      </Row>
      <Row label="Stat Card">
        <StatCard label="Total Posts" value="1,204" icon={BarChart3} trend={{ value: '+12% this month', direction: 'up' }} />
        <StatCard label="Failed Publishes" value="3" trend={{ value: '-2 since last week', direction: 'down' }} />
      </Row>
      <Row label="Table">
        <Table>
          <TableCaption>Recent posts across all connected channels.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DEMO_POSTS.slice(0, 3).map((post) => (
              <TableRow key={post.id}>
                <TableCell>{post.title}</TableCell>
                <TableCell>{post.channel}</TableCell>
                <TableCell>
                  <Badge variant={post.status === 'Published' ? 'primary' : 'outline'}>{post.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Row>
      <Row label="Data Table (sortable + paginated)">
        <DataTable columns={POST_COLUMNS} data={DEMO_POSTS} pageSize={3} className="w-full" />
      </Row>
      <Row label="Timeline">
        <Timeline className="w-80">
          <TimelineItem>
            <TimelineTitle>Post published</TimelineTitle>
            <TimelineDescription>Q3 product recap went live on LinkedIn.</TimelineDescription>
            <TimelineTimestamp>2 hours ago</TimelineTimestamp>
          </TimelineItem>
          <TimelineItem>
            <TimelineTitle>Channel connected</TimelineTitle>
            <TimelineDescription>TikTok was linked to this workspace.</TimelineDescription>
            <TimelineTimestamp>Yesterday</TimelineTimestamp>
          </TimelineItem>
          <TimelineItem isLast>
            <TimelineTitle>Workspace created</TimelineTitle>
            <TimelineTimestamp>3 days ago</TimelineTimestamp>
          </TimelineItem>
        </Timeline>
      </Row>
      <Row label="Accordion">
        <Accordion type="single" collapsible className="w-full max-w-md">
          <AccordionItem value="item-1">
            <AccordionTrigger>What happens when a token expires?</AccordionTrigger>
            <AccordionContent>
              Scheduled posts pause and you&apos;ll get a notification to reconnect the channel.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2">
            <AccordionTrigger>Can I schedule to multiple channels at once?</AccordionTrigger>
            <AccordionContent>Yes — select any combination of connected channels per post.</AccordionContent>
          </AccordionItem>
        </Accordion>
      </Row>
      <Row label="Collapsible">
        <Collapsible open={collapsibleOpen} onOpenChange={setCollapsibleOpen} className="w-full max-w-md">
          <CollapsibleTrigger asChild>
            <Button variant="secondary" className="w-full justify-between">
              Advanced options
              <ChevronsUpDown className="h-4 w-4" strokeWidth={2.5} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 rounded-md border-2 border-outline bg-secondary p-4 font-sans text-sm text-ink">
            UTM parameters, link shortening, and cross-posting rules live here.
          </CollapsibleContent>
        </Collapsible>
      </Row>
      <Row label="List">
        <List className="w-72">
          <ListItem>LinkedIn — Acme Media</ListItem>
          <ListItem>Instagram — Acme Media</ListItem>
          <ListItem>TikTok — Acme Media</ListItem>
        </List>
      </Row>
    </Section>
  );
}
