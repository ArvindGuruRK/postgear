/**
 * Voice — the one prompt fragment every writing stage shares.
 *
 * PRD 5.5 names two tones. They are not "formal vs. casual"; they are *who is
 * speaking*. `personal` is one person writing as themselves: first person
 * singular, "I". `company` is a brand writing as itself: first person plural,
 * "we", with the workspace name where a brand would naturally say its own
 * name. Both the hook and the content stage spell this out in the same words,
 * so a model never gets "I" in the hook and "we" in the body. The simulated
 * client uses {@link pronounsFor} to honour the same choice without a model.
 */
import type { Tone } from '../types';

export interface Pronouns {
  subject: string;
  object: string;
  possessive: string;
  /** How the speaker refers to itself by name — "I" or the brand name. */
  speakerName: string;
  /** Capitalised subject for sentence starts. */
  Subject: string;
}

export function pronounsFor(tone: Tone, workspaceName?: string): Pronouns {
  if (tone === 'personal') {
    return { subject: 'I', object: 'me', possessive: 'my', speakerName: 'I', Subject: 'I' };
  }
  const brand = workspaceName?.trim() || 'our team';
  return { subject: 'we', object: 'us', possessive: 'our', speakerName: brand, Subject: 'We' };
}

/** The voice rules, as a block of prompt lines. */
export function toneRules(tone: Tone, workspaceName?: string): string {
  if (tone === 'personal') {
    return [
      'Voice: personal.',
      'Write in the first person singular — "I", "me", "my". One person sharing their own view.',
      'Never write as a company or use "we"; this is an individual speaking for themselves.',
      'Sound like someone talking to peers: direct, specific, a little opinionated.',
    ].join('\n');
  }
  const brand = workspaceName?.trim() || 'the company';
  return [
    'Voice: company.',
    `Write in the first person plural — "we", "us", "our" — as ${brand}.`,
    `Use the brand name "${brand}" where a company would naturally say its own name.`,
    'Never write as an individual or use "I"; this is the brand speaking.',
    'Sound confident and warm, not corporate: plain words, no buzzwords.',
  ].join('\n');
}
