/**
 * Download All's zip: what an unzip tool gets back, the names it gets them
 * under, and what the browser sees when the archive fails half way.
 */
import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { unzipSync } from 'fflate';
import {
  type ArchiveEntry,
  archiveFileName,
  archiveNames,
  sendArchive,
  zipStored,
} from './design-archive';

async function* from(entries: ArchiveEntry[]): AsyncGenerator<ArchiveEntry> {
  for (const entry of entries) yield entry;
}

function join(parts: Uint8Array[]): Uint8Array {
  const all = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }
  return all;
}

async function collect(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const chunk of chunks) parts.push(chunk);
  return join(parts);
}

const bytes = (text: string) => new TextEncoder().encode(text);

/** "Cafe" with an acute accent, from its code point so the file stays ASCII. */
const CAFE = `Caf${String.fromCodePoint(0xe9)}`;

describe('zipStored', () => {
  it('writes every entry, in order, byte for byte', async () => {
    const zip = await collect(
      zipStored(
        from([
          { name: 'Spring Sale 01.jpg', bytes: bytes('first slide') },
          { name: 'Spring Sale 02.jpg', bytes: bytes('second slide') },
          { name: 'Spring Sale 03.jpg', bytes: bytes('third slide') },
        ]),
      ),
    );

    const files = unzipSync(zip);

    expect(Object.keys(files)).toEqual([
      'Spring Sale 01.jpg',
      'Spring Sale 02.jpg',
      'Spring Sale 03.jpg',
    ]);
    expect(new TextDecoder().decode(files['Spring Sale 02.jpg'])).toBe('second slide');
  });

  it('stores rather than deflates: the slides are already compressed', async () => {
    const zip = await collect(zipStored(from([{ name: 'a.jpg', bytes: bytes('x'.repeat(500)) }])));
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

    // The first local file header: its signature, then the method at byte 8.
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0);
  });

  it('keeps a name outside ASCII as written', async () => {
    const name = `${CAFE} Menu 01.jpg`;
    const zip = await collect(zipStored(from([{ name, bytes: bytes('x') }])));

    expect(Object.keys(unzipSync(zip))).toEqual([name]);
  });

  it('is a valid, empty archive when there is nothing in it', async () => {
    const zip = await collect(zipStored(from([])));

    expect(unzipSync(zip)).toEqual({});
  });

  it('passes on a failure to read an entry', async () => {
    async function* failing(): AsyncGenerator<ArchiveEntry> {
      yield { name: 'one.jpg', bytes: bytes('1') };
      throw new Error('storage went away');
    }

    await expect(collect(zipStored(failing()))).rejects.toThrow('storage went away');
  });
});

const BACKSLASH = String.fromCharCode(92);

describe('archiveNames', () => {
  it('keeps the library names and their extensions', () => {
    expect(
      archiveNames([
        { name: 'Spring Sale 01.jpg', mimeType: 'image/jpeg' },
        { name: 'Spring Sale 02.png', mimeType: 'image/png' },
      ]),
    ).toEqual(['Spring Sale 01.jpg', 'Spring Sale 02.png']);
  });

  it('adds the extension a type calls for when the name lacks one', () => {
    expect(archiveNames([{ name: 'Cover', mimeType: 'image/png' }])).toEqual(['Cover.png']);
  });

  it('cannot be made into a path, a device name or a hidden trailing dot', () => {
    expect(
      archiveNames([
        { name: '../../etc/passwd.jpg', mimeType: 'image/jpeg' },
        { name: `a${BACKSLASH}b:c*d?"e<f>g|h.jpg`, mimeType: 'image/jpeg' },
        { name: 'Ends with dots...jpg', mimeType: 'image/jpeg' },
      ]),
    ).toEqual(['.. .. etc passwd.jpg', 'a b c d e f g h.jpg', 'Ends with dots.jpg']);
  });

  it('numbers a slide whose name is nothing but unsafe characters', () => {
    expect(archiveNames([{ name: '///', mimeType: 'image/jpeg' }])).toEqual(['Slide 01.jpg']);
  });

  it('never gives two slides the same name, whatever the case', () => {
    expect(
      archiveNames([
        { name: 'Slide.jpg', mimeType: 'image/jpeg' },
        { name: 'slide.jpg', mimeType: 'image/jpeg' },
        { name: 'Slide.jpg', mimeType: 'image/jpeg' },
      ]),
    ).toEqual(['Slide.jpg', 'slide (2).jpg', 'Slide (3).jpg']);
  });
});

describe('archiveFileName', () => {
  it('names the zip after the design', () => {
    expect(archiveFileName('Spring Sale')).toBe('Spring Sale.zip');
    expect(archiveFileName('  /// ')).toBe('Design.zip');
  });
});

/** Enough of an Express response to stream into. */
function fakeResponse(options: { refuseAfter?: number } = {}) {
  const emitter = new EventEmitter();
  const written: Uint8Array[] = [];
  const state = {
    destroyed: false,
    ended: false,
    statusCode: 0,
    headers: {} as Record<string, string>,
  };
  const response = Object.assign(emitter, {
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    setHeader(name: string, value: string) {
      state.headers[name] = value;
    },
    write(chunk: Uint8Array) {
      written.push(chunk);
      if (options.refuseAfter !== undefined && written.length >= options.refuseAfter) {
        setImmediate(() => emitter.emit('drain'));
        return false;
      }
      return true;
    },
    end() {
      state.ended = true;
    },
    destroy() {
      state.destroyed = true;
    },
  });
  // A live getter: `Object.assign` would copy the value once.
  Object.defineProperty(response, 'destroyed', { get: () => state.destroyed });

  return { state, written, response: response as unknown as Response };
}

describe('sendArchive', () => {
  it('streams a whole zip with download headers, waiting out backpressure', async () => {
    const { state, written, response } = fakeResponse({ refuseAfter: 1 });

    await sendArchive(
      {
        fileName: 'Spring Sale.zip',
        entries: from([
          { name: 'Spring Sale 01.jpg', bytes: bytes('1') },
          { name: 'Spring Sale 02.jpg', bytes: bytes('2') },
        ]),
      },
      response,
    );

    expect(state.statusCode).toBe(200);
    expect(state.headers['Content-Type']).toBe('application/zip');
    expect(state.headers['Content-Disposition']).toContain('filename="Spring Sale.zip"');
    expect(state.headers['Cache-Control']).toBe('no-store');
    expect(state.ended).toBe(true);
    expect(Object.keys(unzipSync(join(written)))).toEqual([
      'Spring Sale 01.jpg',
      'Spring Sale 02.jpg',
    ]);
  });

  it('cuts the connection rather than ending a zip that failed half way', async () => {
    const { state, response } = fakeResponse();

    async function* failing(): AsyncGenerator<ArchiveEntry> {
      yield { name: 'one.jpg', bytes: bytes('1') };
      throw new Error('storage went away');
    }

    await sendArchive({ fileName: 'x.zip', entries: failing() }, response);

    expect(state.destroyed).toBe(true);
    expect(state.ended).toBe(false);
  });

  it('stops reading once the browser has gone', async () => {
    const { state, response } = fakeResponse();
    let read = 0;

    async function* slides(): AsyncGenerator<ArchiveEntry> {
      for (let index = 0; index < 5; index++) {
        read++;
        if (index === 1) state.destroyed = true;
        yield { name: `${index}.jpg`, bytes: bytes(String(index)) };
      }
    }

    await sendArchive({ fileName: 'x.zip', entries: slides() }, response);

    expect(read).toBe(2);
    expect(state.ended).toBe(false);
  });
});
