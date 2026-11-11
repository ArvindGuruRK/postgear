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
 *
 * Module 08 adds the reader beside it. Read on a card, or Read A Page on the
 * News tab, opens the reader sheet with the place and language being read;
 * Create Post From This, at the end of a read, closes the reader and opens
 * the Create Post sheet on the article. One sheet is open at a time.
 */
import { useState } from 'react';
import { CardMenu } from './card-menu';
import { CreatePostSheet, type CreatePostTarget } from './create-post-sheet';
import { DiscoverView, type DiscoverViewProps } from './discover-view';
import { type ReadRequest, ReaderSheet } from './reader-sheet';

export function DiscoverPage(
  props: Omit<DiscoverViewProps, 'onCreatePost' | 'onRead' | 'renderCardExtra'>,
) {
  const [target, setTarget] = useState<CreatePostTarget | null>(null);
  const [reading, setReading] = useState<ReadRequest | null>(null);

  return (
    <>
      <DiscoverView
        {...props}
        onCreatePost={setTarget}
        onRead={setReading}
        renderCardExtra={(item) => <CardMenu orgId={props.orgId} item={item} />}
      />
      <ReaderSheet
        target={reading?.target ?? null}
        place={reading?.place ?? null}
        language={reading?.language ?? null}
        onClose={() => setReading(null)}
        onCreatePost={(post) => {
          setReading(null);
          setTarget(post);
        }}
      />
      <CreatePostSheet orgId={props.orgId} target={target} onClose={() => setTarget(null)} />
    </>
  );
}
