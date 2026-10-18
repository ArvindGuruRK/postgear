'use client';

import { type ComponentProps, useCallback, useState } from 'react';
import { composerRequest } from '@/lib/composer-request';
import { Composer } from './composer';

type ComposerHostProps = Omit<ComponentProps<typeof Composer>, 'onCreated'> & {
  /** A fresh id from every server render of the composer route. */
  renderId: string;
  /** What that render's URL asked for: `ComposerData.request`. */
  request: string;
};

/**
 * Decides when the composer starts over, which is the one thing a `key`
 * cannot work out on its own.
 *
 * The composer keeps everything in the client, so a remount drops unsaved
 * writing. The server renders the route again for two reasons: a navigation
 * into the composer, which should start from what the URL names, and a
 * `router.refresh()` from anywhere in the app (switching workspace, a channel
 * action), which must leave the writing alone. Both arrive as a new
 * `renderId`. The difference is what they ask for: a refresh asks for the
 * post already open, a navigation for another one.
 *
 * "Already open" follows the composer, not the URL it opened at: after a new
 * post's first save it is that saved post (the URL is rewritten to
 * `?group=` without a navigation), so "New post" from there asks for
 * something else and starts over, while a refresh does not.
 *
 * One case is outside this component's reach (checked 2026-10-19, Next 16):
 * opened in-app over a page that has rewritten its own URL with
 * `history.replaceState` (the calendar adds `?date=`), a refresh makes Next
 * fall back to a full page load. The composer's `beforeunload` guard then
 * asks before any unsaved writing is dropped.
 */
export function ComposerHost({ renderId, request, ...props }: ComposerHostProps) {
  const [session, setSession] = useState({ renderId, open: request, generation: 0 });

  if (renderId !== session.renderId) {
    setSession({
      renderId,
      open: request,
      generation: request === session.open ? session.generation : session.generation + 1,
    });
  }

  const onCreated = useCallback((group: string) => {
    setSession((current) => ({ ...current, open: composerRequest({ group }) }));
  }, []);

  return <Composer key={session.generation} {...props} onCreated={onCreated} />;
}
