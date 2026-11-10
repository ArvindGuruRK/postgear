'use client';

/**
 * The Discover page's island: the view, plus what its cards open (Module
 * 04). Create Post on any card opens the sheet with that card, the place and
 * the language it was read in; each card's overflow menu offers Draft In
 * Copilot. The view stays free of both, so a later tab (Module 05's
 * festivals) can open the same sheet with a date of its own.
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
