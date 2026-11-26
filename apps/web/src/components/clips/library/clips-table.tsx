'use client';

/**
 * The Clips tab's list view (Module 07, section 5): the same clips, filters
 * and menu as the grid, as rows. Name (renamed in place), the platform the
 * video came from, length, shape, a Find Clips pick's score (Module 16),
 * state, made on, and Edit with the menu. The
 * design system's `Table` (no shadow); the page owns paging, so this is not
 * the self-paging `DataTable`.
 */
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@postgear/ui';
import { formatClipLength } from '@postgear/video-engine';
import { useState } from 'react';
import type { ClipListItem } from '@/types/clips';
import { PrimaryLink } from '../button-link';
import { formatShortDate, PLATFORM_LABELS } from '../home/home-model';
import { scoreText } from '../video/find-clips-model';
import { clipEditHref } from '../video/video-clip-list';
import {
  CLIP_STATE_BADGE,
  CLIP_STATE_NAMES,
  type ClipActions,
  ClipMenu,
  RenameField,
} from './clip-actions';
import { isAiOrigin } from '@/types/clips';

export function ClipsTable({
  clips,
  orgId,
  actions,
}: {
  clips: readonly ClipListItem[];
  orgId: string;
  actions: ClipActions;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Platform</TableHead>
          <TableHead>Length</TableHead>
          <TableHead>Shape</TableHead>
          <TableHead>Score</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Made On</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {clips.map((clip) => (
          <TableRow key={clip.id} data-testid="clip-row" data-state={clip.state}>
            <TableCell className="max-w-80">
              {renaming === clip.id ? (
                <RenameField
                  title={clip.title}
                  onSave={(title) => actions.rename(clip, title)}
                  onDone={() => setRenaming(null)}
                />
              ) : (
                <div className="flex min-w-0 flex-col">
                  <span className="truncate type-ui" title={clip.title}>
                    {clip.title}
                  </span>
                  <span className="truncate text-xs type-muted" title={clip.videoTitle}>
                    {clip.videoTitle}
                  </span>
                </div>
              )}
            </TableCell>
            <TableCell>{PLATFORM_LABELS[clip.platform]}</TableCell>
            <TableCell className="tabular-nums">{formatClipLength(clip.durationMs)}</TableCell>
            <TableCell className="tabular-nums">{clip.ratio}</TableCell>
            <TableCell className="tabular-nums" data-testid="clip-row-score">
              {isAiOrigin(clip.origin) ? (scoreText(clip.score) ?? '') : ''}
            </TableCell>
            <TableCell>
              <Badge variant={CLIP_STATE_BADGE[clip.state]}>{CLIP_STATE_NAMES[clip.state]}</Badge>
            </TableCell>
            <TableCell className="whitespace-nowrap">{formatShortDate(clip.createdAt)}</TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-1">
                <PrimaryLink href={clipEditHref(orgId, clip.id)}>Edit</PrimaryLink>
                <ClipMenu
                  clip={clip}
                  actions={actions}
                  onStartRename={() => setRenaming(clip.id)}
                />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
