/**
 * `checkValidity`, implemented once.
 *
 * Before Sprint 4 each provider hand-wrote its media rules as `if` statements,
 * visible only to the API. Every provider now declares `rules` and delegates
 * here, so the rule the composer shows in the browser and the rule enforced
 * before publishing are one object run through one validator.
 *
 * `PostDetails.message` is already platform text — the publisher renders the
 * document before calling the provider — so it is validated as-is.
 */
import { validatePost } from '../composer/validate';
import type { PostDetails, SocialProvider } from './social.provider.interface';

export function checkAgainstRules(
  provider: Pick<SocialProvider, 'name' | 'rules' | 'maxLength'>,
  posts: PostDetails[],
): string | true {
  const settings = posts[0]?.settings;
  const title = typeof settings?.title === 'string' ? settings.title : undefined;

  const issues = validatePost(
    // The account can raise the limit above the static rule (X Premium).
    { ...provider.rules, maxLength: provider.maxLength(settings) },
    posts.map((post) => ({
      text: post.message,
      media: (post.media ?? []).map((item) => ({
        type: item.type,
        mimeType: item.mimeType,
        bytes: item.bytes,
        width: item.width,
        height: item.height,
      })),
    })),
    { providerName: provider.name, title },
  );

  return issues[0]?.message ?? true;
}
