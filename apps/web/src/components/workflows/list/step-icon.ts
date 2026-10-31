/**
 * The icon key of a step kind, for the list's cards. An unknown kind (a step
 * type this version does not know) gets the generic flow glyph.
 */
import { getDefinition } from '@postgear/automation';

export function getStepIcon(type: string): string {
  return getDefinition(type)?.icon ?? 'run';
}
