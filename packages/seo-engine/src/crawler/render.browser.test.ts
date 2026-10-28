/**
 * The pool's render path in real Chromium, opt-in:
 * `SEO_BROWSER_TESTS=true npx jest render.browser`.
 *
 * Checks the three things the design exporter relies on: the shot is the
 * exact size asked for, the page's own script runs and its result comes back,
 * and nothing in the page can reach the network, whatever it tries.
 */
import { createBrowserPool } from './browser.pool';
import { startTestServer, type TestServer } from './test-server';

const enabled = process.env.SEO_BROWSER_TESTS === 'true';
const describeBrowser = enabled ? describe : describe.skip;

/** Width and height from a PNG's header chunk. */
function pngSize(image: Buffer): { width: number; height: number } {
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}

describeBrowser('render with real Chromium', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('shoots at the exact size, runs the page script and blocks the network', async () => {
    server.routes.set('/pixel.png', (_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end();
    });

    const html = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;width:1080px;height:1350px;background:#123456}</style></head>
<body>
<img src="${server.origin}/pixel.png" alt="">
<link rel="stylesheet" href="${server.origin}/style.css">
<script>
  fetch('${server.origin}/api').catch(function () {});
  window.__result = ['headline'];
  window.__done = true;
</script>
</body></html>`;

    const pool = createBrowserPool({ launchTimeoutMs: 60_000 });

    try {
      expect(await pool.available()).toBe(true);

      const result = await pool.render({
        html,
        width: 1080,
        height: 1350,
        type: 'png',
        waitForFunction: 'window.__done === true',
        collect: 'window.__result',
      });

      expect(pngSize(result.image)).toEqual({ width: 1080, height: 1350 });
      expect(result.value).toEqual(['headline']);
      expect(server.requests).toEqual([]);
    } finally {
      await pool.close();
    }
  }, 90_000);

  it('waits for a page that is not ready at the first look, under a policy without eval', async () => {
    // The design export page's own policy (design-engine render/export-html.ts):
    // inline script, no 'unsafe-eval'. Waiting from inside the page evaluated
    // the expression again on each poll, which this policy refuses.
    const html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:">
<style>html,body{margin:0;width:200px;height:200px;background:#123456}</style></head>
<body><script>setTimeout(function () { window.__ready = 'late'; }, 300);</script></body></html>`;

    const pool = createBrowserPool({ launchTimeoutMs: 60_000 });

    try {
      const result = await pool.render({
        html,
        width: 200,
        height: 200,
        type: 'png',
        waitForFunction: "window.__ready === 'late'",
        collect: 'window.__ready',
        timeoutMs: 5_000,
      });

      expect(result.value).toBe('late');
      expect(pngSize(result.image)).toEqual({ width: 200, height: 200 });
    } finally {
      await pool.close();
    }
  }, 90_000);

  it('gives up on a page that never finishes, without keeping its slot', async () => {
    const pool = createBrowserPool({ maxPages: 1, launchTimeoutMs: 60_000 });

    try {
      await expect(
        pool.render({
          html: '<!doctype html><p>never</p>',
          width: 100,
          height: 100,
          type: 'png',
          waitForFunction: 'false',
          timeoutMs: 1_000,
        }),
      ).rejects.toThrow();

      const result = await pool.render({
        html: '<!doctype html><p>ok</p>',
        width: 100,
        height: 100,
        type: 'jpeg',
        quality: 80,
      });
      expect(result.image.subarray(0, 2).toString('hex')).toBe('ffd8');
    } finally {
      await pool.close();
    }
  }, 90_000);
});
