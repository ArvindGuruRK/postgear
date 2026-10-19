/**
 * What a composer URL asks for, as one comparable string: a saved post by its
 * group, or a new post with what it starts from (a library item, a time, a
 * starter template, a post to duplicate, a channel).
 *
 * Kept apart from `composer-data.ts`, which is server-only, because both
 * sides compare it: the loader names the request it served, and the client
 * names the post it has become after a first save (`ComposerHost`).
 *
 * The template is part of the request so that picking a second template from
 * Home, with the first still open, starts over with the new text rather than
 * being taken for a refresh of the post already open. The same goes for
 * duplicating a second post, or starting one for another channel.
 */
export function composerRequest(request: {
  group?: string | null;
  media?: string | null;
  at?: string | null;
  template?: string | null;
  duplicate?: string | null;
  channel?: string | null;
}): string {
  return request.group
    ? `group=${request.group}`
    : `new:media=${request.media ?? ''}:at=${request.at ?? ''}:template=${request.template ?? ''}:duplicate=${request.duplicate ?? ''}:channel=${request.channel ?? ''}`;
}
