import { SeoCrawlError } from '../types';
import { assertSafeUrl, isPrivateAddress, normaliseUrl } from './url-guard';

const publicResolver = async () => ['93.184.216.34'];

describe('isPrivateAddress', () => {
  it.each([
    ['0.0.0.0', true],
    ['0.1.2.3', true],
    ['10.0.0.5', true],
    ['100.64.0.1', true],
    ['100.127.255.255', true],
    ['100.128.0.1', false],
    ['127.0.0.1', true],
    ['127.255.255.254', true],
    ['169.254.169.254', true],
    ['169.254.1.1', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['192.0.0.1', true],
    ['192.0.2.1', true],
    ['192.168.1.1', true],
    ['198.18.0.1', true],
    ['198.19.255.255', true],
    ['198.51.100.7', true],
    ['203.0.113.9', true],
    ['224.0.0.1', true],
    ['239.255.255.255', true],
    ['240.0.0.1', true],
    ['255.255.255.255', true],
    ['8.8.8.8', false],
    ['93.184.216.34', false],
    ['1.1.1.1', false],
    ['::', true],
    ['::1', true],
    ['[::1]', true],
    ['::ffff:127.0.0.1', true],
    ['::ffff:10.1.1.1', true],
    ['::ffff:8.8.8.8', false],
    ['64:ff9b::7f00:1', true],
    ['64:ff9b::808:808', false],
    ['fc00::1', true],
    ['fd12:3456::1', true],
    ['fe80::1', true],
    ['fe80::1%eth0', true],
    ['febf::1', true],
    ['fec0::1', false],
    ['ff02::1', true],
    ['2001:db8::1', true],
    ['2001:db9::1', false],
    ['2606:4700:4700::1111', false],
    ['not-an-ip', true],
    ['', true],
    ['1.2.3', true],
    ['1.2.3.256', true],
  ])('%s → %s', (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});

describe('normaliseUrl', () => {
  it('lower-cases the host, drops the fragment and the default port', () => {
    expect(normaliseUrl('HTTPS://Example.COM:443/Path?q=1#frag')).toBe(
      'https://example.com/Path?q=1',
    );
    expect(normaliseUrl('http://example.com:80/')).toBe('http://example.com/');
  });

  it('keeps a non-default port for the guard to judge', () => {
    expect(normaliseUrl('http://example.com:8080/x')).toBe('http://example.com:8080/x');
  });

  it('rejects credentials, other schemes and garbage with a reason', () => {
    const reasonOf = (input: string) => {
      try {
        normaliseUrl(input);
      } catch (error) {
        return error instanceof SeoCrawlError ? error.reason : 'not-a-crawl-error';
      }
      return 'accepted';
    };
    expect(reasonOf('http://user:pw@example.com')).toBe('credentials');
    expect(reasonOf('http://user@example.com')).toBe('credentials');
    expect(reasonOf('ftp://example.com/file')).toBe('scheme');
    expect(reasonOf('javascript:alert(1)')).toBe('scheme');
    expect(reasonOf('not a url')).toBe('invalid');
    expect(reasonOf('')).toBe('invalid');
  });
});

describe('assertSafeUrl', () => {
  const rejectReason = async (input: string, resolve = publicResolver) => {
    const result = await assertSafeUrl(input, { resolve });
    return result.ok ? 'accepted' : result.reason;
  };

  it('fails closed on localhost (the DoD test)', async () => {
    expect(await rejectReason('http://localhost')).toBe('host_forbidden');
    // The host rule runs before the port rule: localhost is refused as such.
    expect(await rejectReason('http://localhost:3000/')).toBe('host_forbidden');
    expect(await rejectReason('http://app.localhost/')).toBe('host_forbidden');
    expect(await rejectReason('http://LOCALHOST./')).toBe('host_forbidden');
  });

  it('fails closed on the cloud metadata address (the DoD test)', async () => {
    const result = await assertSafeUrl('http://169.254.169.254/latest/meta-data');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('private_address');
      expect(result.message).toMatch(/private or internal network address/);
    }
    expect(await rejectReason('http://metadata.google.internal/computeMetadata/v1/')).toBe(
      'host_forbidden',
    );
  });

  it('rejects private and loopback IP literals in every spelling', async () => {
    expect(await rejectReason('http://127.0.0.1')).toBe('private_address');
    expect(await rejectReason('http://[::1]')).toBe('private_address');
    expect(await rejectReason('http://[::ffff:127.0.0.1]')).toBe('private_address');
    expect(await rejectReason('http://10.0.0.5')).toBe('private_address');
    expect(await rejectReason('http://192.168.1.1')).toBe('private_address');
    expect(await rejectReason('http://0.0.0.0')).toBe('private_address');
  });

  it('rejects reserved host names', async () => {
    expect(await rejectReason('http://db.internal/')).toBe('host_forbidden');
    expect(await rejectReason('http://printer.local/')).toBe('host_forbidden');
    expect(await rejectReason('http://nas.home.arpa/')).toBe('host_forbidden');
  });

  it('rejects other schemes, credentials and ports', async () => {
    expect(await rejectReason('ftp://example.com/')).toBe('scheme');
    expect(await rejectReason('http://user:pw@example.com')).toBe('credentials');
    expect(await rejectReason('http://example.com:8080')).toBe('port');
    expect(await rejectReason('https://example.com:8443/x')).toBe('port');
  });

  it('allows a listed port', async () => {
    const result = await assertSafeUrl('http://example.com:8080/', {
      resolve: publicResolver,
      allowPorts: [8080],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a host that resolves to a private address', async () => {
    expect(await rejectReason('http://evil.example/', async () => ['10.1.2.3'])).toBe(
      'private_address',
    );
    expect(await rejectReason('http://evil.example/', async () => ['::1'])).toBe('private_address');
  });

  it('rejects a host with mixed public and private records', async () => {
    const result = await assertSafeUrl('http://mixed.example/', {
      resolve: async () => ['93.184.216.34', '169.254.169.254'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('private_address');
      expect(result.message).toContain('169.254.169.254');
    }
  });

  it('rejects an unresolvable host and an empty answer', async () => {
    expect(
      await rejectReason('http://nope.example/', async () => {
        throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
      }),
    ).toBe('unresolvable');
    expect(await rejectReason('http://nope.example/', async () => [])).toBe('unresolvable');
  });

  it('accepts a public URL, normalised without the fragment', async () => {
    const result = await assertSafeUrl('https://Example.com/path?q=1#frag', {
      resolve: publicResolver,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url.toString()).toBe('https://example.com/path?q=1');
      expect(result.url.hash).toBe('');
      expect(result.addresses).toEqual(['93.184.216.34']);
    }
  });

  it('accepts a public IP literal without resolving', async () => {
    const resolve = jest.fn(publicResolver);
    const result = await assertSafeUrl('http://93.184.216.34/', { resolve });
    expect(result.ok).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
    if (result.ok) expect(result.addresses).toEqual(['93.184.216.34']);
  });

  it('never throws', async () => {
    await expect(assertSafeUrl('')).resolves.toMatchObject({ ok: false, reason: 'invalid' });
    await expect(assertSafeUrl('http://')).resolves.toMatchObject({ ok: false });
  });
});
