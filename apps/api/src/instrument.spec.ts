/**
 * What Sentry is told to collect. Discover's query strings carry a rounded position
 * or a typed city, in requests coming in and in the calls going out to OpenStreetMap,
 * and the SDK's own default would keep them in events, breadcrumbs and spans. The
 * setting is one line, and losing it would be silent, so a test holds it.
 */
jest.mock('@sentry/nestjs', () => ({ init: jest.fn() }));

const { init } = jest.requireMock('@sentry/nestjs') as { init: jest.Mock };

async function loadInstrument(): Promise<void> {
  await jest.isolateModulesAsync(async () => {
    await import('./instrument');
  });
}

describe('Sentry setup', () => {
  const original = process.env.SENTRY_DSN;

  beforeEach(() => {
    init.mockReset();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = original;
  });

  it('never collects a query string', async () => {
    process.env.SENTRY_DSN = 'https://key@sentry.example.test/1';

    await loadInstrument();

    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ dataCollection: { urlQueryParams: false } }),
    );
  });

  it('does not start with no DSN', async () => {
    delete process.env.SENTRY_DSN;

    await loadInstrument();

    expect(init).not.toHaveBeenCalled();
  });
});
