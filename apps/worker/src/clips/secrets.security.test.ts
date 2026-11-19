/**
 * Security sweep, Secrets (Sprint 12, Module 20): the yt-dlp proxy, the
 * operator's cookies file, the signing secret and the storage keys never
 * reach a worker log line, whatever a tool printed or an error said.
 *
 * Each test sets secret-looking values the way the worker's `.env` would,
 * makes the activity failure path log, captures everything printed and
 * looks for every value in it.
 */
import { RenderError, ToolError } from '@postgear/media-tools';
import { loadWorkerEnv } from '../config/env';
import { clipFailure } from './failures';
import { LOG_SECRET_NAMES, logSecretsFrom, REDACTED, scrubSecrets } from './log-redaction';

const PROXY_PASSWORD = 'proxy-pass-9a8b7c6d';
const SECRETS: Record<string, string> = {
  CLIPS_URL_SECRET: 'clips-url-secret-0123456789abcdef0123',
  S3_ACCESS_KEY: 'AKIAEXAMPLEACCESS0042',
  S3_SECRET_KEY: 's3-secret-key-5f4e3d2c1b0a99887766',
  YTDLP_PROXY: `http://proxyuser42:${PROXY_PASSWORD}@10.9.8.7:3128`,
  YTDLP_COOKIES_FILE: '/run/secrets/operator-youtube-cookies.txt',
  AUTOMATION_INTERNAL_TOKEN: 'ab'.repeat(32),
  ENCRYPTION_KEY_AES256: 'cd'.repeat(32),
  TWITCH_CLIENT_ID: 'twitch-client-id-7f3a9c',
  TWITCH_CLIENT_SECRET: 'twitch-client-secret-4e8b0d',
  CLIPS_YOUTUBE_API_KEY: 'AIzaYoutubeKeyExample1c5e9a',
};
/** Pieces that must not survive on their own either. */
const PIECES = [PROXY_PASSWORD, '10.9.8.7:3128', 'operator-youtube-cookies.txt', 'cookies.txt'];
const ALL = [...Object.values(SECRETS), ...PIECES];

/** What a misbehaving tool or library could print: every secret, in the shapes they take. */
const NOISY = [
  `ERROR: Unable to connect to proxy ${SECRETS.YTDLP_PROXY}: Tunnel connection failed`,
  `[debug] Command-line config: ['--proxy', '${SECRETS.YTDLP_PROXY}', '--cookies', '/tmp/postgear-clips/job-1/cookies.txt']`,
  `ERROR: '${SECRETS.YTDLP_COOKIES_FILE}' does not look like a Netscape format cookies file`,
  `[http @ 0x55] -http_proxy ${SECRETS.YTDLP_PROXY} refused`,
  `signing with ${SECRETS.CLIPS_URL_SECRET}; S3 ${SECRETS.S3_ACCESS_KEY}/${SECRETS.S3_SECRET_KEY}`,
  `internal ${SECRETS.AUTOMATION_INTERNAL_TOKEN} key ${SECRETS.ENCRYPTION_KEY_AES256}`,
  `helix ${SECRETS.TWITCH_CLIENT_ID} ${SECRETS.TWITCH_CLIENT_SECRET} youtube ${SECRETS.CLIPS_YOUTUBE_API_KEY}`,
].join('\n');

const saved: Record<string, string | undefined> = {};
let printed: string[] = [];

beforeEach(() => {
  for (const [name, value] of Object.entries(SECRETS)) {
    saved[name] = process.env[name];
    process.env[name] = value;
  }
  printed = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      printed.push(args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' '));
    });
  }
});

afterEach(() => {
  for (const name of Object.keys(SECRETS)) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  jest.restoreAllMocks();
});

/** Every secret found in the text, raw or as JSON escapes it. */
function leaks(text: string): string[] {
  const decoded = text.replace(/\\\\/g, '\\');
  return ALL.filter((value) => text.includes(value) || decoded.includes(value));
}

describe('the activity failure log', () => {
  it('logs a yt-dlp failure with its stderr, every secret scrubbed out', () => {
    const error = new ToolError({ tool: 'yt-dlp', exitCode: 1, stderrTail: NOISY });
    const failure = clipFailure(error, { activity: 'clipProbe', jobId: 'job-1' });

    expect(failure.details?.[0]).toEqual({ code: 'tool_failed' });
    expect(printed).toHaveLength(1);
    const line = JSON.parse(printed[0] as string) as Record<string, string>;
    // Still useful: the event, the code and the tool's own words are there.
    expect(line).toMatchObject({ event: 'clips.activity.failed', code: 'tool_failed' });
    expect(line.stderrTail).toContain('Tunnel connection failed');
    expect(line.stderrTail).toContain(REDACTED);
    expect(leaks(printed.join('\n'))).toEqual([]);
  });

  it('scrubs a render failure the same way', () => {
    const error = new RenderError('tool_failed', { stderrTail: NOISY });
    clipFailure(error, { activity: 'renderExecute', jobId: 'job-2' });
    expect(printed).toHaveLength(1);
    expect(leaks(printed.join('\n'))).toEqual([]);
  });

  it('scrubs the reason of an error it does not know', () => {
    clipFailure(new Error(NOISY), { activity: 'importStore' });
    clipFailure(`a thrown string ${SECRETS.S3_SECRET_KEY}`, { activity: 'importStore' });
    expect(printed).toHaveLength(2);
    expect(leaks(printed.join('\n'))).toEqual([]);
  });

  it('never puts a tool output or a secret in the failure Temporal stores', () => {
    const failure = clipFailure(new ToolError({ tool: 'ffmpeg', exitCode: 1, stderrTail: NOISY }), {
      activity: 'renderExecute',
    });
    expect(leaks(`${failure.message} ${JSON.stringify(failure.details)}`)).toEqual([]);
    expect(failure.cause).toBeUndefined();
  });
});

describe('scrubSecrets', () => {
  it('knows every variable the sweep names', () => {
    expect([...LOG_SECRET_NAMES].sort()).toEqual(Object.keys(SECRETS).sort());
    const values = logSecretsFrom(SECRETS);
    for (const value of [...Object.values(SECRETS), PROXY_PASSWORD, '10.9.8.7:3128']) {
      expect(values).toContain(value);
    }
  });

  it('hides a login inside any address and the values after the flags, with nothing set', () => {
    const text = [
      'socks5://someone:hunter2hunter2@proxy.example:1080 failed',
      '--proxy http://p.example:8080 --cookies /home/op/my-session.txt',
      '-http_proxy=http://q.example:3128',
      'copy of C:/scratch/job-9/cookies.txt',
    ].join('\n');
    const out = scrubSecrets(text, {});
    expect(out).not.toContain('hunter2hunter2');
    expect(out).not.toContain('p.example:8080');
    expect(out).not.toContain('my-session.txt');
    expect(out).not.toContain('q.example:3128');
    expect(out).not.toContain('cookies.txt');
    // An ordinary address is left alone: the log still says what was asked.
    expect(scrubSecrets('https://www.youtube.com/watch?v=abc', {})).toBe(
      'https://www.youtube.com/watch?v=abc',
    );
  });

  it('leaves short values alone, so a one letter setting cannot blank out the log', () => {
    expect(scrubSecrets('a plain sentence', { S3_ACCESS_KEY: 'a' })).toBe('a plain sentence');
  });
});

describe('the boot refusal', () => {
  const base = {
    DATABASE_URL: 'postgresql://localhost/db',
    ENCRYPTION_KEY_AES256: SECRETS.ENCRYPTION_KEY_AES256,
    AUTOMATION_INTERNAL_TOKEN: SECRETS.AUTOMATION_INTERNAL_TOKEN,
  };

  function bootMessage(raw: Record<string, string>): string {
    try {
      loadWorkerEnv({ ...base, ...raw });
      return '';
    } catch (error) {
      return (error as Error).message;
    }
  }

  it('names the variable but never repeats its value', () => {
    const shortSecret = 'too-short-url-secret-77';
    const badProxy = 'proxy pass-word-8812 not an address';
    const shapes = bootMessage({ CLIPS_URL_SECRET: shortSecret, YTDLP_PROXY: badProxy });
    expect(shapes).toContain('CLIPS_URL_SECRET');
    expect(shapes).toContain('YTDLP_PROXY');
    // The cross checks run once every value has its shape: half an S3 key pair.
    const pair = bootMessage({
      STORAGE_PROVIDER: 's3',
      S3_PUBLIC_URL: 'https://cdn.example.com',
      S3_BUCKET_NAME: 'postgear-media',
      S3_ACCESS_KEY: SECRETS.S3_ACCESS_KEY,
    });
    expect(pair).toContain('S3_SECRET_KEY');
    for (const value of [shortSecret, badProxy, 'pass-word-8812', SECRETS.S3_ACCESS_KEY]) {
      expect(`${shapes}\n${pair}`).not.toContain(value);
    }
  });
});
