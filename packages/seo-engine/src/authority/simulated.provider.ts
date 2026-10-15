/**
 * The authority stand-in for local development and tests.
 *
 * Follows the sprint's simulation rule: deterministic from the input, so a
 * test can assert on it and the same URL scores the same twice. The domain
 * authority is an FNV-1a hash of the host name folded into 20–85 — the range
 * real sites occupy — and the PageRank is the matching 0–10 decimal, so the
 * evaluator's two checks agree the way they would with real data.
 */
import type { AuthorityEstimate, AuthorityProvider } from '../types';

export const SIMULATED_AUTHORITY_MIN = 20;
export const SIMULATED_AUTHORITY_MAX = 85;

/** 32-bit FNV-1a; small, fast, and stable across platforms. */
export function hashHostname(hostname: string): number {
  let hash = 0x811c9dc5;
  for (const char of hostname.toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function simulatedAuthorityFor(hostname: string): AuthorityEstimate {
  const span = SIMULATED_AUTHORITY_MAX - SIMULATED_AUTHORITY_MIN + 1;
  const host = hostname.toLowerCase().replace(/^www\./, '');
  const domainAuthority = SIMULATED_AUTHORITY_MIN + (hashHostname(host) % span);
  return {
    source: 'simulation',
    domainAuthority,
    pageRank: Math.round(domainAuthority) / 10,
  };
}

export function createSimulatedAuthorityProvider(): AuthorityProvider {
  return {
    name: 'simulation',
    async estimate(hostname) {
      return simulatedAuthorityFor(hostname);
    },
  };
}
