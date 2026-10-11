import { mediaUrlBuilder } from './media-url';

describe('mediaUrlBuilder', () => {
  const key = '2026/10/0123456789abcdef0123456789abcdef.jpg';

  it('serves local keys from the API uploads route', () => {
    const url = mediaUrlBuilder({ STORAGE_PROVIDER: 'local', API_URL: 'http://localhost:3001/' });
    expect(url(key)).toBe(`http://localhost:3001/uploads/${key}`);
  });

  it('serves S3 keys from the public bucket URL', () => {
    const url = mediaUrlBuilder({
      STORAGE_PROVIDER: 's3',
      API_URL: 'http://localhost:3001',
      S3_PUBLIC_URL: 'http://localhost:9000/postgear-media/',
    });
    expect(url(key)).toBe(`http://localhost:9000/postgear-media/${key}`);
  });

  it('refuses keys PostGear did not generate', () => {
    const url = mediaUrlBuilder({ STORAGE_PROVIDER: 'local', API_URL: 'http://localhost:3001' });
    expect(() => url('../etc/passwd')).toThrow(/did not generate/);
    expect(() => url('https://evil.example/x.jpg')).toThrow(/did not generate/);
  });
});
