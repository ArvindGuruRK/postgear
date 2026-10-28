/**
 * The file name Download All saves its zip as, read from the API's
 * `Content-Disposition` header (`fileNameFrom` in `api.ts`).
 *
 * The API writes both forms, as RFC 6266 suggests: a plain quoted name every
 * browser understands, and a `filename*` UTF-8 form that keeps a title like
 * "Frühling Sale" intact. The UTF-8 form wins when it can be read.
 */
import { fileNameFrom } from './api';

describe('fileNameFrom', () => {
  it('prefers the UTF-8 form over the plain one', () => {
    expect(
      fileNameFrom(
        `attachment; filename="Fruhling Sale.zip"; filename*=UTF-8''Fr%C3%BChling%20Sale.zip`,
      ),
    ).toBe('Frühling Sale.zip');
  });

  it('reads the UTF-8 form whatever case its parts are written in', () => {
    expect(fileNameFrom(`attachment; FILENAME*=utf-8''Spring%20Sale.zip`)).toBe('Spring Sale.zip');
  });

  it('reads the plain quoted form on its own', () => {
    expect(fileNameFrom('attachment; filename="Spring Sale.zip"')).toBe('Spring Sale.zip');
  });

  it('falls back to the plain form when the UTF-8 form has a malformed escape', () => {
    expect(
      fileNameFrom(`attachment; filename="Spring Sale.zip"; filename*=UTF-8''Spring%E0%A4%A.zip`),
    ).toBe('Spring Sale.zip');
  });

  it('gives up on a malformed escape with no plain form to fall back on', () => {
    expect(fileNameFrom(`attachment; filename*=UTF-8''Spring%E0%A4%A.zip`)).toBeNull();
  });

  it('has nothing to read without a header, or without a file name in it', () => {
    expect(fileNameFrom(null)).toBeNull();
    expect(fileNameFrom('')).toBeNull();
    expect(fileNameFrom('attachment')).toBeNull();
  });
});
