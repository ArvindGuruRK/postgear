/**
 * What a composer URL asks for, as one comparable string: a saved post by its
 * group, or a new post with what it starts from (a library item, a time).
 *
 * Kept apart from `composer-data.ts`, which is server-only, because both
 * sides compare it: the loader names the request it served, and the client
 * names the post it has become after a first save (`ComposerHost`).
 */
export function composerRequest(request: {
  group?: string | null;
  media?: string | null;
  at?: string | null;
}): string {
  return request.group
    ? `group=${request.group}`
    : `new:media=${request.media ?? ''}:at=${request.at ?? ''}`;
}
