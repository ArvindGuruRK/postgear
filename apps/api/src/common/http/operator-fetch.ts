/**
 * A fetch for a service the operator runs and names in the environment, such as
 * a self-hosted Nominatim (Discover, Sprint 11 Module 10).
 *
 * The guarded fetch (`fetchUrlSafely`) refuses private addresses, and it must:
 * it is what every address a person typed goes through. A service the operator
 * set up for PostGear usually lives on exactly such an address (a compose
 * network, `localhost`, a VPC), so it needs a door of its own. This one is
 * locked to one origin, read from the environment at boot: any other address,
 * and any redirect away from that origin, is refused before a request is made.
 * Nothing a person types can choose where it goes.
 *
 * It keeps the guarded fetch's other habits: a timeout, a cap on the body, no
 * cookies, and an answer whatever the status, so the caller can tell a 429.
 */

export interface OperatorFetchInit {
  accept: string;
  signal: AbortSignal;
  maxBytes: number;
  userAgent?: string;
}

export interface OperatorFetchResponse {
  status: number;
  body: string;
  finalUrl: string;
  contentType: string | null;
}

export type OperatorFetch = (url: string, init: OperatorFetchInit) => Promise<OperatorFetchResponse>;

const DEFAULT_TIMEOUT_MS = 8_000;

export class OperatorFetchRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperatorFetchRefused';
  }
}

/** Reads at most `maxBytes` of a body, and refuses one that is larger. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new OperatorFetchRefused('The answer is too large.');
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new OperatorFetchRefused('The answer is too large.');
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

/**
 * A fetch that only ever reaches `baseUrl`'s origin. Throws at boot when the
 * address is not http or https, so a typo in the environment is loud.
 */
export function createOperatorFetch(
  baseUrl: string,
  { userAgent, timeoutMs = DEFAULT_TIMEOUT_MS }: { userAgent: string; timeoutMs?: number },
): OperatorFetch {
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new OperatorFetchRefused('An operator service must be an http or https address.');
  }

  return async (url, init) => {
    const target = new URL(url);
    if (target.origin !== base.origin) {
      throw new OperatorFetchRefused('That address is not the configured service.');
    }

    const response = await globalThis.fetch(target, {
      method: 'GET',
      headers: { accept: init.accept, 'user-agent': init.userAgent ?? userAgent },
      // A redirect could point anywhere, so none is followed.
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]),
    });

    return {
      status: response.status,
      body: await readCapped(response, init.maxBytes),
      finalUrl: target.toString(),
      contentType: response.headers.get('content-type'),
    };
  };
}
