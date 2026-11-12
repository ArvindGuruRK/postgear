'use client';

/**
 * Add Competitor and Edit Competitor (Module 07, story DC-7.1): a name and a
 * website, the feeds PostGear found there as a list to tick, and the channels
 * no website can tell us (a YouTube channel id, an Instagram username, a
 * Bluesky handle, a Mastodon account, a news search phrase). Instagram is read
 * through the workspace's own connected business account (Module 10).
 *
 * ## Finding feeds
 *
 * The website is asked for its feeds when the person presses Find Feeds, or
 * leaves the field with a new address in it. Never per keystroke: the API
 * allows a workspace five of these a minute, and each one is a request to a
 * stranger's site. An answer for an address the person has since changed is
 * dropped. What comes back is merged into the list, ticked while fewer than
 * five are; a site with none says so and points at the paste field under it,
 * which is always there.
 *
 * ## Refusals keep the dialog open
 *
 * A private address, a website that does not exist, the twentieth competitor
 * already followed: the API says each in its own sentence, and that sentence
 * is shown here as it is, with everything typed still in place. A field the
 * API would only call "Invalid input" is checked here first (`competitor-model.ts`),
 * so the person is told which one.
 */
import { SearchIcon } from '@animateicons/react/lucide/search-icon';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormErrorMessage,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  MotionIcon,
} from '@postgear/ui';
import { type FocusEvent, type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { createCompetitor, findCompetitorFeeds, updateCompetitor } from '@/lib/discover-api';
import type { Competitor } from '@/types/discover';
import {
  addPastedFeed,
  BLUESKY_HINT,
  COMPETITOR_NAME_MAX,
  type CompetitorField,
  type CompetitorForm,
  competitorInput,
  competitorPatch,
  FIND_FAILED,
  FINDING_FEEDS,
  feedChoiceLabel,
  feedChoiceShowsAddress,
  formFrom,
  formProblems,
  INSTAGRAM_HINT,
  MASTODON_HINT,
  mergeFoundFeeds,
  NEWS_HINT,
  NEWS_QUERY_MAX,
  NO_FEEDS_FOUND,
  newsPhrase,
  SAVE_FAILED,
  toggleFeed,
  WEBSITE_HINT,
  websiteAddress,
  YOUTUBE_HINT,
} from './competitor-model';

export interface CompetitorDialogProps {
  open: boolean;
  /** The competitor being edited. Null adds a new one. */
  competitor: Competitor | null;
  onClose: () => void;
  /** The competitor as the API saved it. The dialog closes itself first. */
  onSaved: (competitor: Competitor) => void;
}

/** The API's own sentence for a refusal; ours when it never answered. */
function sentenceOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : fallback;
}

export function CompetitorDialog({ open, competitor, onClose, onSaved }: CompetitorDialogProps) {
  const ids = useId();
  const [form, setForm] = useState<CompetitorForm>(() => formFrom(competitor));
  const [problems, setProblems] = useState<Partial<Record<CompetitorField, string>>>({});
  const [finding, setFinding] = useState(false);
  const [foundNone, setFoundNone] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [feedsProblem, setFeedsProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The website the feeds on screen belong to, so leaving the field unchanged asks nothing.
  const searched = useRef('');
  // Counts the searches, so an answer that lands after a newer one began is dropped.
  const search = useRef(0);
  const findButton = useRef<HTMLButtonElement>(null);

  // A fresh form every time it opens, from the competitor it opens on.
  useEffect(() => {
    if (!open) return;
    const start = formFrom(competitor);
    setForm(start);
    setProblems({});
    setFinding(false);
    setFoundNone(false);
    setFindError(null);
    setPaste('');
    setFeedsProblem(null);
    setSaving(false);
    setSaveError(null);
    searched.current = start.website.trim();
    search.current += 1;
  }, [open, competitor]);

  function change(patch: Partial<CompetitorForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  async function findFeeds() {
    const website = form.website.trim();
    if (!website) return;
    // Not an address at all: say so here, where the API would only say "Invalid input".
    if (!websiteAddress(website)) {
      setProblems((current) => ({ ...current, website: WEBSITE_HINT }));
      return;
    }
    setProblems(({ website: _cleared, ...rest }) => rest);

    searched.current = website;
    search.current += 1;
    const mine = search.current;
    setFinding(true);
    setFoundNone(false);
    setFindError(null);
    setFeedsProblem(null);

    try {
      const found = await findCompetitorFeeds(website);
      if (search.current !== mine) return;
      setForm((current) => ({ ...current, feeds: mergeFoundFeeds(current.feeds, found) }));
      setFoundNone(found.length === 0);
    } catch (cause) {
      if (search.current !== mine) return;
      setFindError(sentenceOf(cause, FIND_FAILED));
    } finally {
      if (search.current === mine) setFinding(false);
    }
  }

  function websiteBlurred(event: FocusEvent<HTMLInputElement>) {
    // Leaving the field for the button: the click asks, so the blur must not ask too.
    if (event.relatedTarget === findButton.current) return;
    const website = form.website.trim();
    if (website && website !== searched.current) void findFeeds();
  }

  function addFeed() {
    const result = addPastedFeed(form.feeds, paste);
    if (!result.ok) {
      setFeedsProblem(result.problem);
      return;
    }
    setForm((current) => ({ ...current, feeds: result.feeds }));
    setPaste('');
    setFeedsProblem(null);
  }

  function tick(url: string, checked: boolean) {
    const result = toggleFeed(form.feeds, url, checked);
    if (!result.ok) {
      setFeedsProblem(result.problem);
      return;
    }
    setForm((current) => ({ ...current, feeds: result.feeds }));
    setFeedsProblem(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const found = formProblems(form);
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    setSaveError(null);

    try {
      if (competitor) {
        // Only what changed, so an address nobody touched is not looked up again.
        const patch = competitorPatch(form, competitor);
        const saved =
          Object.keys(patch).length > 0 ? await updateCompetitor(competitor.id, patch) : competitor;
        onClose();
        onSaved(saved);
        return;
      }

      const saved = await createCompetitor(competitorInput(form));
      onClose();
      onSaved(saved);
    } catch (cause) {
      setSaveError(sentenceOf(cause, SAVE_FAILED));
    } finally {
      setSaving(false);
    }
  }

  const field = (name: string) => `${ids}-${name}`;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-xl">
        <form onSubmit={save} noValidate>
          <DialogHeader>
            <DialogTitle>{competitor ? 'Edit Competitor' : 'Add Competitor'}</DialogTitle>
            <DialogDescription>
              Enter their website and we look for what they publish. Everything else is optional.
            </DialogDescription>
          </DialogHeader>

          <div className="pg-scrollbar pg-scrollbar-secondary -mx-2 mt-4 flex max-h-[min(65vh,40rem)] flex-col gap-4 overflow-y-auto px-2 pt-1 pb-2">
            <FormField>
              <FormLabel htmlFor={field('name')} required>
                Name
              </FormLabel>
              <Input
                id={field('name')}
                value={form.name}
                onChange={(event) => change({ name: event.target.value })}
                maxLength={COMPETITOR_NAME_MAX}
                placeholder="Enter your competitor's name"
                autoComplete="off"
                variant={problems.name ? 'error' : 'default'}
              />
              {problems.name ? <FormErrorMessage>{problems.name}</FormErrorMessage> : null}
            </FormField>

            <FormField>
              <FormLabel htmlFor={field('website')}>Website</FormLabel>
              <div className="flex flex-wrap gap-2">
                <Input
                  id={field('website')}
                  className="min-w-0 flex-1 basis-56"
                  value={form.website}
                  onChange={(event) => change({ website: event.target.value })}
                  onBlur={websiteBlurred}
                  placeholder="Enter your competitor's website"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  variant={problems.website ? 'error' : 'default'}
                />
                <Button
                  ref={findButton}
                  type="button"
                  variant="secondary"
                  onClick={() => void findFeeds()}
                  disabled={finding || form.website.trim() === ''}
                  aria-busy={finding}
                >
                  <MotionIcon icon={SearchIcon} className="h-4 w-4" />
                  Find Feeds
                </Button>
              </div>
              {problems.website ? <FormErrorMessage>{problems.website}</FormErrorMessage> : null}
              {findError ? (
                <Alert variant="danger" className="py-3" data-testid="competitor-find-error">
                  {findError}
                </Alert>
              ) : null}
            </FormField>

            <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
              <legend className="mb-2 p-0 font-sans text-sm font-bold text-ink">Feeds</legend>
              <p
                className="m-0 font-sans text-sm text-ink type-muted empty:hidden"
                role="status"
                data-testid="competitor-feeds-status"
              >
                {finding ? FINDING_FEEDS : foundNone ? NO_FEEDS_FOUND : ''}
              </p>
              {form.feeds.length > 0 ? (
                <ul
                  className="m-0 flex list-none flex-col gap-2 p-0"
                  data-testid="competitor-feed-list"
                >
                  {form.feeds.map((feed, index) => {
                    const id = field(`feed-${index}`);
                    return (
                      <li key={feed.url} className="flex min-w-0 items-start gap-3">
                        <Checkbox
                          id={id}
                          className="mt-0.5"
                          checked={feed.checked}
                          onCheckedChange={(checked) => tick(feed.url, checked === true)}
                        />
                        <label htmlFor={id} className="flex min-w-0 flex-col gap-0.5">
                          <span dir="auto" className="break-all font-sans text-sm text-ink">
                            {feedChoiceLabel(feed)}
                          </span>
                          {feedChoiceShowsAddress(feed) ? (
                            <span className="break-all font-sans text-xs text-ink type-muted">
                              {feed.url}
                            </span>
                          ) : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Input
                  className="min-w-0 flex-1 basis-56"
                  value={paste}
                  onChange={(event) => setPaste(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter here adds the feed. It must not save the whole form.
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    addFeed();
                  }}
                  placeholder="Enter your feed address"
                  aria-label="Feed address"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={addFeed}
                  disabled={paste.trim() === ''}
                >
                  Add
                </Button>
              </div>
              {feedsProblem ? <FormErrorMessage>{feedsProblem}</FormErrorMessage> : null}
            </fieldset>

            <FormField>
              <FormLabel htmlFor={field('youtube')}>YouTube channel id</FormLabel>
              <Input
                id={field('youtube')}
                value={form.youtube}
                onChange={(event) => change({ youtube: event.target.value })}
                placeholder="Enter your competitor's YouTube channel id"
                autoComplete="off"
                spellCheck={false}
                variant={problems.youtube ? 'error' : 'default'}
              />
              {problems.youtube ? (
                <FormErrorMessage>{problems.youtube}</FormErrorMessage>
              ) : (
                <FormHelperText>{YOUTUBE_HINT}</FormHelperText>
              )}
            </FormField>

            <FormField>
              <FormLabel htmlFor={field('instagram')}>Instagram</FormLabel>
              <Input
                id={field('instagram')}
                value={form.instagram}
                onChange={(event) => change({ instagram: event.target.value })}
                maxLength={120}
                placeholder="Enter your competitor's Instagram username"
                autoComplete="off"
                spellCheck={false}
                variant={problems.instagram ? 'error' : 'default'}
              />
              {problems.instagram ? (
                <FormErrorMessage>{problems.instagram}</FormErrorMessage>
              ) : (
                <FormHelperText>{INSTAGRAM_HINT}</FormHelperText>
              )}
            </FormField>

            <FormField>
              <FormLabel htmlFor={field('bluesky')}>Bluesky handle</FormLabel>
              <Input
                id={field('bluesky')}
                value={form.bluesky}
                onChange={(event) => change({ bluesky: event.target.value })}
                placeholder="Enter your competitor's Bluesky handle"
                autoComplete="off"
                spellCheck={false}
                variant={problems.bluesky ? 'error' : 'default'}
              />
              {problems.bluesky ? (
                <FormErrorMessage>{problems.bluesky}</FormErrorMessage>
              ) : (
                <FormHelperText>{BLUESKY_HINT}</FormHelperText>
              )}
            </FormField>

            <FormField>
              <FormLabel htmlFor={field('mastodon')}>Mastodon account</FormLabel>
              <Input
                id={field('mastodon')}
                value={form.mastodon}
                onChange={(event) => change({ mastodon: event.target.value })}
                placeholder="Enter your competitor's Mastodon account"
                autoComplete="off"
                spellCheck={false}
                variant={problems.mastodon ? 'error' : 'default'}
              />
              {problems.mastodon ? (
                <FormErrorMessage>{problems.mastodon}</FormErrorMessage>
              ) : (
                <FormHelperText>{MASTODON_HINT}</FormHelperText>
              )}
            </FormField>

            <FormField>
              <FormLabel htmlFor={field('news')}>News search phrase</FormLabel>
              <Input
                id={field('news')}
                value={newsPhrase(form)}
                onChange={(event) => change({ news: event.target.value, newsEdited: true })}
                maxLength={NEWS_QUERY_MAX}
                placeholder="Enter your news search phrase"
                autoComplete="off"
                variant={problems.news ? 'error' : 'default'}
              />
              {problems.news ? (
                <FormErrorMessage>{problems.news}</FormErrorMessage>
              ) : (
                <FormHelperText>{NEWS_HINT}</FormHelperText>
              )}
            </FormField>
          </div>

          {saveError ? (
            <Alert variant="danger" className="mt-4 py-3" data-testid="competitor-save-error">
              {saveError}
            </Alert>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={saving}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={saving} aria-busy={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
