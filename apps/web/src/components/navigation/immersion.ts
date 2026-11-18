/**
 * Whether a page is its own module and so takes the whole window: no rail, no
 * top bar (2026-10-31). Creating a workflow or a design, or editing a clip,
 * moves into a separate place, the way Figma or n8n open a file, so the app
 * frame steps out of the way and the page brings its own way back.
 *
 * - `'fixed'`: a workspace that fills the height and scrolls its own panels
 *   (Studio's editor, `studio/{designId}`, and the clip editor,
 *   `clips/edit/{clipId}`).
 * - `'edge'`: the same, right up to the window's edge (the workflow builder,
 *   `workflows/{id}`, whose canvas has no frame).
 * - `'scroll'`: a page that scrolls as one (Studio's Create Design wizard,
 *   `studio/new`).
 *
 * The lists (`workflows`, `studio`, `clips`) and the video page
 * (`clips/video/{videoId}`) keep the frame.
 *
 * `page` is the path under the workspace, with no leading slash
 * (`studio/abc`, `clips/edit/abc`).
 */
export type Immersion = 'fixed' | 'edge' | 'scroll';

export function immersion(page: string): Immersion | null {
  const [segment, child, ...deeper] = page.split('/');

  // The clip editor is two levels down, under the Clips page and beside the
  // video page, so it has a rule of its own: exactly `clips/edit/{clipId}`.
  if (segment === 'clips') {
    return child === 'edit' && deeper.length === 1 && deeper[0] !== '' ? 'fixed' : null;
  }

  if (segment !== 'studio' && segment !== 'workflows') return null;
  if (!child || deeper.length > 0) return null;
  if (segment === 'studio') return child === 'new' ? 'scroll' : 'fixed';
  return 'edge';
}
