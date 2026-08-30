import type { LucideIcon } from 'lucide-react';
import { Timeline, TimelineDescription, TimelineItem, TimelineTimestamp, TimelineTitle } from './timeline';

export interface ActivityItem {
  id: string;
  title: string;
  description?: string;
  timestamp: string;
  icon?: LucideIcon;
}

export interface ActivityFeedProps {
  items: ActivityItem[];
  className?: string;
}

export function ActivityFeed({ items, className }: ActivityFeedProps) {
  return (
    <Timeline className={className}>
      {items.map((item, index) => (
        <TimelineItem key={item.id} isLast={index === items.length - 1}>
          <TimelineTitle>{item.title}</TimelineTitle>
          {item.description && <TimelineDescription>{item.description}</TimelineDescription>}
          <TimelineTimestamp>{item.timestamp}</TimelineTimestamp>
        </TimelineItem>
      ))}
    </Timeline>
  );
}
