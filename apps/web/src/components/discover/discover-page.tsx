'use client';

/**
 * The Discover page's island: the view, plus what its cards open (Module
 * 04). Create Post on any card or row opens the sheet with that item, the
 * place and the language it was read in; each card's overflow menu offers
 * Draft In Copilot. The view stays free of both, and a festival's Plan A Post
 * (Module 05) opens the same sheet with a date of its own.
 *
 * `isAdmin` and the workspace's saved `settings` (Module 06) come from the
 * server page and go straight through to the view.
 */
import { useState } from 'react';
import { CardMenu } from './card-menu';
import { CreatePostSheet, type CreatePostTarget } from './create-post-sheet';
import { DiscoverView, type DiscoverViewProps } from './discover-view';

export function DiscoverPage(props: Omit<DiscoverViewProps, 'onCreatePost' | 'renderCardExtra'>) {
  const [target, setTarget] = useState<CreatePostTarget | null>(null);

  return (
    <>
      <DiscoverView
        {...props}
        onCreatePost={setTarget}
        renderCardExtra={(item) => <CardMenu orgId={props.orgId} item={item} />}
      />
      <CreatePostSheet orgId={props.orgId} target={target} onClose={() => setTarget(null)} />
    </>
  );
}
