/**
 * The URL policy: https-only through the SSRF guard normally, any http(s)
 * address when private URLs are allowed for local testing. The resolver is
 * injected so no test touches DNS.
 */
import { judgeWebhookUrl } from './webhook-url';
import { WEBHOOK_MESSAGES } from './webhooks.messages';

const publicResolve = async () => ['93.184.216.34'];

describe('judgeWebhookUrl', () => {
  describe('normal policy', () => {
    it('accepts a public https URL and normalises it', async () => {
      const verdict = await judgeWebhookUrl('HTTPS://Hooks.Example.com/in#frag', {
        allowPrivate: false,
        resolve: publicResolve,
      });
      expect(verdict).toEqual({ ok: true, url: 'https://hooks.example.com/in' });
    });

    it('refuses http', async () => {
      const verdict = await judgeWebhookUrl('http://hooks.example.com/in', {
        allowPrivate: false,
        resolve: publicResolve,
      });
      expect(verdict).toEqual({ ok: false, message: WEBHOOK_MESSAGES.URL_SCHEME });
    });

    it.each([
      'https://localhost/in',
      'https://169.254.169.254/latest/meta-data',
      'https://user:pw@hooks.example.com/in',
      'https://hooks.example.com:8443/in',
      'https://[::1]/in',
      'not a url',
    ])('refuses %s', async (url) => {
      const verdict = await judgeWebhookUrl(url, { allowPrivate: false, resolve: publicResolve });
      expect(verdict.ok).toBe(false);
    });

    it('refuses a host that resolves to a private address', async () => {
      const verdict = await judgeWebhookUrl('https://internal.example.com/in', {
        allowPrivate: false,
        resolve: async () => ['93.184.216.34', '10.0.0.5'],
      });
      expect(verdict.ok).toBe(false);
      expect((verdict as { message: string }).message).toMatch(/private or internal/);
    });
  });

  describe('private URLs allowed (local testing)', () => {
    it('accepts http on localhost with a port', async () => {
      expect(await judgeWebhookUrl('http://localhost:4000/hook', { allowPrivate: true })).toEqual({
        ok: true,
        url: 'http://localhost:4000/hook',
      });
    });

    it('still refuses other schemes and credentials', async () => {
      expect((await judgeWebhookUrl('ftp://localhost/hook', { allowPrivate: true })).ok).toBe(false);
      expect((await judgeWebhookUrl('http://a:b@localhost/hook', { allowPrivate: true })).ok).toBe(false);
      expect((await judgeWebhookUrl('nope', { allowPrivate: true })).ok).toBe(false);
    });
  });
});
