/**
 * Media grid tiles with posters and lengths (Sprint 12, Module 19): the
 * Media page's `LibraryTile` and the composer picker's `MediaTile` show a
 * video's poster with its length in the corner, fall back to the first frame
 * (the file itself, `preload="metadata"`) when there is no poster or it will
 * not load, and leave images as they were.
 */
import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import type { MediaItem } from '@/types/media';
import { LibraryTile } from './library-tile';
import { MediaTile } from './media-tile';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const VIDEO_URL = 'http://localhost:3001/uploads/2026/11/0123456789abcdef0123456789abcdef.mp4';
const POSTER_URL =
  'http://localhost:3001/uploads/2026/11/0123456789abcdef0123456789abcdef.thumb.webp';

function video(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'm1',
    name: 'launch.mp4',
    type: 'video',
    mimeType: 'video/mp4',
    fileSize: 4_200_000,
    width: 1080,
    height: 1920,
    url: VIDEO_URL,
    thumbnailUrl: POSTER_URL,
    createdAt: '2026-11-19T09:00:00.000Z',
    durationMs: 42_400,
    ...overrides,
  };
}

const tiles = {
  library: (item: MediaItem) =>
    render(
      <TooltipProvider>
        <ul>
          <LibraryTile orgId="seed-demo-org" item={item} onOpen={jest.fn()} onDelete={jest.fn()} />
        </ul>
      </TooltipProvider>,
    ),
  picker: (item: MediaItem) => render(<MediaTile item={item} onToggle={jest.fn()} />),
};

describe.each(Object.entries(tiles))('the %s tile', (_name, renderTile) => {
  it('shows the poster and the length, not the video file', () => {
    const { container } = renderTile(video());

    const poster = container.querySelector('img');
    expect(poster).toHaveAttribute('src', POSTER_URL);
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByTestId('media-length')).toHaveTextContent('0:42');
  });

  it('shows hours past an hour', () => {
    renderTile(video({ durationMs: 3_725_000 }));
    expect(screen.getByTestId('media-length')).toHaveTextContent('1:02:05');
  });

  it('falls back to the first frame when there is no poster yet, without a length', () => {
    const { container } = renderTile(video({ thumbnailUrl: null, durationMs: null }));

    const frame = container.querySelector('video');
    expect(frame).toHaveAttribute('src', VIDEO_URL);
    expect(frame).toHaveAttribute('preload', 'metadata');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByTestId('media-length')).toBeNull();
  });

  it('falls back to the first frame when the poster will not load', () => {
    const { container } = renderTile(video());

    fireEvent.error(container.querySelector('img') as HTMLImageElement);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('video')).toHaveAttribute('src', VIDEO_URL);
    expect(screen.getByTestId('media-length')).toHaveTextContent('0:42');
  });

  it('leaves an image as it was, with no length', () => {
    const { container } = renderTile(
      video({
        type: 'image',
        mimeType: 'image/jpeg',
        url: 'http://localhost:3001/uploads/2026/11/a.jpg',
        thumbnailUrl: 'http://localhost:3001/uploads/2026/11/a.thumb.webp',
        durationMs: null,
      }),
    );

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'http://localhost:3001/uploads/2026/11/a.thumb.webp',
    );
    expect(screen.queryByTestId('media-length')).toBeNull();
  });
});
