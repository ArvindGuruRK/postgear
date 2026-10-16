/**
 * The webhook sender against a local HTTP server: the headers and signature
 * a receiver gets, and how each kind of answer is classified. The SSRF guard
 * is exercised with an injected resolver so nothing touches DNS; the server
 * itself is reached through the "allow private" path, since it is local.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  verifyWebhookSignature,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from '@postgear/db';
import { sendWebhook, WEBHOOK_USER_AGENT, webhookHeaders } from './webhook-sender';

interface Received {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

let server: Server;
let baseUrl: string;
let received: Received[] = [];
let handler: (req: IncomingMessage, res: ServerResponse, body: string) => void;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      received.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received = [];
  handler = (_req, res) => {
    res.statusCode = 200;
    res.end('ok');
  };
});

const SECRET = 'whsec_local';
const BODY = JSON.stringify({ id: 'd-1', event: 'post.published', data: { post: { id: 'g1' } } });

function send(overrides: Partial<Parameters<typeof sendWebhook>[0]> = {}) {
  return sendWebhook({
    url: `${baseUrl}/hook`,
    secret: SECRET,
    deliveryId: 'd-1',
    event: 'post.published',
    body: BODY,
    allowPrivate: true,
    timeoutMs: 2_000,
    ...overrides,
  });
}

describe('sendWebhook', () => {
  it('POSTs the body with the event, delivery, timestamp and a verifiable signature', async () => {
    const outcome = await send({ timestamp: 1_760_000_000 });

    expect(outcome).toMatchObject({ outcome: 'delivered', statusCode: 200 });
    expect(received).toHaveLength(1);
    const [request] = received;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/hook');
    expect(request.body).toBe(BODY);
    expect(request.headers['content-type']).toBe('application/json');
    expect(request.headers['user-agent']).toBe(WEBHOOK_USER_AGENT);
    expect(request.headers[WEBHOOK_EVENT_HEADER]).toBe('post.published');
    expect(request.headers[WEBHOOK_DELIVERY_HEADER]).toBe('d-1');
    expect(request.headers[WEBHOOK_TIMESTAMP_HEADER]).toBe('1760000000');
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: request.body,
        signatureHeader: request.headers[WEBHOOK_SIGNATURE_HEADER] as string,
        timestampHeader: request.headers[WEBHOOK_TIMESTAMP_HEADER] as string,
        now: new Date(1_760_000_000 * 1000),
      }),
    ).toEqual({ ok: true });
  });

  it('builds the same headers the sender puts on the wire', () => {
    const headers = webhookHeaders({
      secret: SECRET,
      deliveryId: 'd-1',
      event: 'post.failed',
      body: '{}',
      timestamp: 42,
    });
    expect(headers['content-length']).toBe('2');
    expect(headers[WEBHOOK_SIGNATURE_HEADER]).toMatch(/^v1=[0-9a-f]{64}$/);
  });

  it.each([
    [500, 'retry'],
    [503, 'retry'],
    [429, 'retry'],
    [408, 'retry'],
    [400, 'rejected'],
    [401, 'rejected'],
    [404, 'rejected'],
    [410, 'rejected'],
  ] as const)('classifies a %i as %s', async (status, expected) => {
    handler = (_req, res) => {
      res.statusCode = status;
      res.end('nope');
    };

    const outcome = await send();

    expect(outcome.outcome).toBe(expected);
    expect(outcome).toMatchObject({ statusCode: status, error: `Receiver answered ${status}` });
  });

  it('treats a 204 with no body as delivered', async () => {
    handler = (_req, res) => {
      res.statusCode = 204;
      res.end();
    };
    expect((await send()).outcome).toBe('delivered');
  });

  it('gives up after the timeout and asks for a retry', async () => {
    handler = () => {
      // Never answers; the sender's timer must fire.
    };

    const outcome = await send({ timeoutMs: 300 });

    expect(outcome).toMatchObject({ outcome: 'retry', statusCode: null });
    expect((outcome as { error: string }).error).toMatch(/No response within/);
  });

  it('reports a connection refusal as retryable', async () => {
    const outcome = await send({ url: 'http://127.0.0.1:1/hook' });
    expect(outcome).toMatchObject({ outcome: 'retry', statusCode: null, error: 'Connection refused' });
  });

  it('refuses a URL the SSRF guard rejects before sending anything', async () => {
    const outcome = await send({ url: 'http://169.254.169.254/latest', allowPrivate: false });
    expect(outcome.outcome).toBe('unsafe');
    expect(received).toHaveLength(0);

    const resolved = await send({
      url: 'https://hooks.example.com/x',
      allowPrivate: false,
      resolve: async () => ['10.0.0.9'],
    });
    expect(resolved.outcome).toBe('unsafe');
    expect(received).toHaveLength(0);
  });

  it('with private URLs allowed, still refuses a non-http scheme', async () => {
    const outcome = await send({ url: 'ftp://127.0.0.1/hook' });
    expect(outcome.outcome).toBe('unsafe');
  });
});
