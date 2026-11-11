/**
 * Module 09's accessibility and script checks, on the pieces as the page draws
 * them:
 *
 * - a group is a `section` named by its heading, a card is an `article` named
 *   by its title, which is a heading;
 * - every Create Post, Read and Plan A Post says which item it is for, so a
 *   list of forty buttons is not forty times the same name;
 * - everything that can be pressed is a real button or link, in the tab order;
 * - whatever moves has a `motion-reduce:` partner;
 * - a title in Tamil, Arabic or Japanese carries `dir="auto"` wherever it is
 *   shown, so the browser picks the direction and nothing is guessed here.
 *
 * The three scripts come from the playground's invented samples.
 */
import '@testing-library/jest-dom';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  SCRIPT_ROW_GROUP,
  SCRIPT_SAMPLES,
  SCRIPT_STORY_GROUP,
} from '@/app/dev/components/sections/discover-script-samples';
import type { DiscoverItem, DiscoverGroup as Group } from '@/types/discover';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { CompetitorRows } from './competitor-row';
import { DiscoverGroup } from './discover-group';
import { ReaderArticleBody } from './reader-sheet';

beforeAll(stubBrowserLayout);

const NOW = new Date('2026-11-10T12:00:00Z');
const TODAY = '2026-11-10';

const TITLES = SCRIPT_SAMPLES.map((sample) => [sample.language, sample.story] as const);

function group(id: Group['id'], title: string, items: DiscoverItem[]): Group {
  return {
    id,
    title,
    subtitle: 'Invented samples.',
    attribution: { name: 'Samples' },
    stale: false,
    fetchedAt: '2026-11-10T11:00:00Z',
    items,
  };
}

function trend(title: string): DiscoverItem {
  return {
    id: `trend-${title}`,
    kind: 'trend',
    source: { id: 'google-trends', name: 'Google Trends' },
    title,
    url: 'https://example.com/trend',
    signal: { label: '200+ searches' },
    brief: 'An invented sample search.',
  };
}

function video(title: string): DiscoverItem {
  return {
    id: `video-${title}`,
    kind: 'video',
    source: { id: 'youtube', name: 'YouTube' },
    title,
    url: 'https://example.com/watch',
    summary: 'Sample Channel',
    brief: 'An invented sample video.',
  };
}

function topic(title: string): DiscoverItem {
  return {
    id: `topic-${title}`,
    kind: 'social',
    source: { id: 'bluesky', name: 'Bluesky' },
    title,
    url: 'https://example.com/topic',
    signal: { label: '120 posts' },
    brief: 'An invented sample topic.',
  };
}

function festival(title: string): DiscoverItem {
  return {
    id: `festival-${title}`,
    kind: 'festival',
    source: { id: 'holidays', name: 'Holidays' },
    title,
    date: '2026-11-12',
    observance: true,
    brief: 'An invented sample festival.',
  };
}

function competitor(title: string): DiscoverItem {
  return {
    id: `competitor-${title}`,
    kind: 'competitor',
    source: { id: 'rss', name: 'Acme Analytics Blog' },
    title,
    url: 'https://acme.example/blog/sample',
    publishedAt: '2026-11-09T09:00:00Z',
    brief: 'An invented sample post.',
  };
}

function draw(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

/** The nearest element that states a direction, from the text itself outwards. */
function directionOf(text: string): string | null {
  return screen.getByText(text).closest('[dir]')?.getAttribute('dir') ?? null;
}

describe('a group and its cards, for a screen reader', () => {
  it('is a section named by its heading', () => {
    draw(<DiscoverGroup group={SCRIPT_STORY_GROUP} now={NOW} />);

    const section = screen.getByRole('region', { name: 'Sample Stories In Three Scripts' });
    expect(section.tagName).toBe('SECTION');
    expect(
      within(section).getByRole('heading', { name: 'Sample Stories In Three Scripts' }),
    ).toBeInTheDocument();
  });

  it('draws each card as an article named by its title, which is a heading', () => {
    draw(<DiscoverGroup group={SCRIPT_STORY_GROUP} now={NOW} />);

    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(3);
    for (const [index, sample] of SCRIPT_SAMPLES.entries()) {
      const card = cards[index] as HTMLElement;
      expect(card.tagName).toBe('ARTICLE');
      expect(card).toHaveAccessibleName(sample.story);
      expect(within(card).getByRole('heading', { name: sample.story })).toBeInTheDocument();
    }
  });

  it('names Create Post and Read after the card they belong to', () => {
    const onCreatePost = jest.fn();
    const onRead = jest.fn();
    draw(
      <DiscoverGroup
        group={SCRIPT_STORY_GROUP}
        now={NOW}
        onCreatePost={onCreatePost}
        onRead={onRead}
      />,
    );

    for (const item of SCRIPT_STORY_GROUP.items) {
      fireEvent.click(screen.getByRole('button', { name: `Create Post for ${item.title}` }));
      expect(onCreatePost).toHaveBeenLastCalledWith(item);
      fireEvent.click(screen.getByRole('button', { name: `Read ${item.title}` }));
      expect(onRead).toHaveBeenLastCalledWith(item);
    }
    // Three cards, three different names for each button.
    expect(screen.getAllByRole('button', { name: /^Create Post for / })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /^Read / })).toHaveLength(3);
  });

  it('keeps the words on the button short: the long name is for a screen reader only', () => {
    draw(
      <DiscoverGroup
        group={SCRIPT_STORY_GROUP}
        now={NOW}
        onCreatePost={jest.fn()}
        onRead={jest.fn()}
      />,
    );

    const first = SCRIPT_STORY_GROUP.items[0] as DiscoverItem;
    expect(
      screen.getByRole('button', { name: `Create Post for ${first.title}` }),
    ).toHaveTextContent(/^Create Post$/);
    expect(screen.getByRole('button', { name: `Read ${first.title}` })).toHaveTextContent(/^Read$/);
  });

  it('names Create Post after its row on a Wikipedia row', () => {
    const onCreatePost = jest.fn();
    draw(<DiscoverGroup group={SCRIPT_ROW_GROUP} now={NOW} onCreatePost={onCreatePost} />);

    for (const item of SCRIPT_ROW_GROUP.items) {
      fireEvent.click(screen.getByRole('button', { name: `Create Post for ${item.title}` }));
      expect(onCreatePost).toHaveBeenLastCalledWith(item);
    }
  });

  it('names Plan A Post after its festival', () => {
    const onPlanPost = jest.fn();
    const items = TITLES.map(([, title]) => festival(title));
    draw(
      <DiscoverGroup
        group={group('festivals', 'Festivals In India', items)}
        now={NOW}
        today={TODAY}
        onPlanPost={onPlanPost}
      />,
    );

    for (const item of items) {
      fireEvent.click(screen.getByRole('button', { name: `Plan A Post for ${item.title}` }));
      expect(onPlanPost).toHaveBeenLastCalledWith(item);
    }
  });

  it("names Create Post after its row on a competitor's row", () => {
    const onCreatePost = jest.fn();
    const items = TITLES.map(([, title]) => competitor(title));
    draw(<CompetitorRows items={items} now={NOW} onCreatePost={onCreatePost} />);

    for (const item of items) {
      fireEvent.click(screen.getByRole('button', { name: `Create Post for ${item.title}` }));
      expect(onCreatePost).toHaveBeenLastCalledWith(item);
    }
  });
});

describe('reaching everything by keyboard', () => {
  /** Buttons and links take focus by themselves; nothing here may be taken out of the tab order. */
  function expectReachable(scope: HTMLElement, controls: number) {
    const pressable = [
      ...within(scope).queryAllByRole('button'),
      ...within(scope).queryAllByRole('link'),
    ];
    expect(pressable).toHaveLength(controls);
    for (const control of pressable) {
      expect(['BUTTON', 'A']).toContain(control.tagName);
      if (control.tagName === 'A') expect(control).toHaveAttribute('href');
      expect(control).not.toHaveAttribute('tabindex', '-1');
      expect(control).not.toBeDisabled();
      control.focus();
      expect(control).toHaveFocus();
    }
    // Nothing is made pressable with a click handler on a plain element.
    expect(scope.querySelectorAll('[role="button"]:not(button)')).toHaveLength(0);
  }

  it('reaches Create Post, Read and Open on a story card', () => {
    draw(
      <DiscoverGroup
        group={SCRIPT_STORY_GROUP}
        now={NOW}
        onCreatePost={jest.fn()}
        onRead={jest.fn()}
      />,
    );

    expectReachable(screen.getAllByRole('article')[0] as HTMLElement, 3);
  });

  it('reaches the title, Create Post and Open on a Wikipedia row', () => {
    draw(<DiscoverGroup group={SCRIPT_ROW_GROUP} now={NOW} onCreatePost={jest.fn()} />);

    expectReachable(screen.getAllByTestId('discover-wiki-row')[0] as HTMLElement, 3);
  });

  it('reaches Plan A Post on a festival row', () => {
    draw(
      <DiscoverGroup
        group={group('festivals', 'Festivals In India', [festival('Sample Festival')])}
        now={NOW}
        today={TODAY}
        onPlanPost={jest.fn()}
      />,
    );

    expectReachable(screen.getByTestId('discover-festival-row'), 1);
  });

  it("reaches the title, Create Post and Open on a competitor's row", () => {
    draw(<CompetitorRows items={[competitor('Sample post')]} now={NOW} onCreatePost={jest.fn()} />);

    expectReachable(screen.getByTestId('discover-competitor-row'), 3);
  });

  it('reaches every social chip, each a link out', () => {
    const items = TITLES.map(([, title]) => topic(title));
    draw(<DiscoverGroup group={group('social', 'Talked About Worldwide', items)} now={NOW} />);

    expectReachable(screen.getByRole('region', { name: 'Talked About Worldwide' }), 3);
  });

  it('lets the article in the reader take focus, so it can be scrolled by keyboard', () => {
    draw(<ReaderArticleBody article={{ text: 'One paragraph.', image: null }} />);

    const article = screen.getByRole('region', { name: 'Article' });
    expect(article).toHaveAttribute('tabindex', '0');
    article.focus();
    expect(article).toHaveFocus();
  });
});

describe('titles in Tamil, Arabic and Japanese', () => {
  it.each(TITLES)(
    'lets the browser pick the direction on a story card (%s)',
    (_language, title) => {
      draw(<DiscoverGroup group={SCRIPT_STORY_GROUP} now={NOW} />);

      expect(screen.getByRole('heading', { name: title })).toHaveAttribute('dir', 'auto');
    },
  );

  it.each(TITLES)(
    'lets the browser pick the direction on a trend card (%s)',
    (_language, title) => {
      draw(<DiscoverGroup group={group('trends', 'Rising Searches', [trend(title)])} now={NOW} />);

      expect(screen.getByRole('heading', { name: title })).toHaveAttribute('dir', 'auto');
    },
  );

  it.each(TITLES)(
    'lets the browser pick the direction on a video card, and of its channel (%s)',
    (_language, title) => {
      draw(
        <DiscoverGroup
          group={group('videos', 'Trending Videos', [{ ...video(title), summary: title }])}
          now={NOW}
        />,
      );

      const card = screen.getByRole('article', { name: title });
      expect(within(card).getByRole('heading', { name: title })).toHaveAttribute('dir', 'auto');
      // The channel line repeats the sample here, so both lines are looked at.
      for (const line of within(card).getAllByText(title)) {
        expect(line).toHaveAttribute('dir', 'auto');
      }
    },
  );

  it.each(SCRIPT_SAMPLES.map((sample) => [sample.language, sample.row] as const))(
    'lets the browser pick the direction on a Wikipedia row (%s)',
    (_language, title) => {
      draw(<DiscoverGroup group={SCRIPT_ROW_GROUP} now={NOW} />);

      expect(directionOf(title)).toBe('auto');
    },
  );

  it.each(TITLES)(
    'lets the browser pick the direction on a social chip (%s)',
    (_language, title) => {
      draw(
        <DiscoverGroup
          group={group('social', 'Talked About Worldwide', [topic(title)])}
          now={NOW}
        />,
      );

      expect(directionOf(title)).toBe('auto');
    },
  );

  it.each(TITLES)(
    'lets the browser pick the direction on a festival row (%s)',
    (_language, title) => {
      draw(
        <DiscoverGroup
          group={group('festivals', 'Festivals In India', [festival(title)])}
          now={NOW}
          today={TODAY}
        />,
      );

      expect(directionOf(title)).toBe('auto');
    },
  );

  it.each(TITLES)(
    "lets the browser pick the direction on a competitor's row (%s)",
    (_language, title) => {
      draw(<CompetitorRows items={[competitor(title)]} now={NOW} />);

      expect(directionOf(title)).toBe('auto');
    },
  );

  it.each(TITLES)(
    "lets the browser pick the direction of each of the reader's paragraphs (%s)",
    (_language, title) => {
      draw(<ReaderArticleBody article={{ text: `${title}\n\n${title} 2`, image: null }} />);

      const text = screen.getByTestId('reader-text');
      expect(text).toHaveAttribute('dir', 'auto');
      const paragraphs = text.querySelectorAll('p');
      expect(paragraphs).toHaveLength(2);
      for (const paragraph of paragraphs) expect(paragraph).toHaveAttribute('dir', 'auto');
    },
  );

  it('never states a direction of its own: no rtl or ltr is written anywhere', () => {
    draw(
      <>
        <DiscoverGroup group={SCRIPT_STORY_GROUP} now={NOW} onCreatePost={jest.fn()} />
        <DiscoverGroup group={SCRIPT_ROW_GROUP} now={NOW} onCreatePost={jest.fn()} />
      </>,
    );

    expect(document.querySelectorAll('[dir="rtl"], [dir="ltr"]')).toHaveLength(0);
  });
});

describe('reduced motion', () => {
  const FOLDER = __dirname;
  const sources = readdirSync(FOLDER)
    .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
    .map((name) => ({ name, lines: readFileSync(join(FOLDER, name), 'utf8').split(/\r?\n/) }));

  /** A class that moves something: an animation, or a transition. */
  const MOVES = /(?<![\w:-])(animate-(?!none)[\w-]+|transition(-[\w-]+)?)(?![\w-])/;

  it('reads the Discover components', () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.some((file) => file.lines.some((line) => MOVES.test(line)))).toBe(true);
  });

  it('gives every animation and transition a motion-reduce partner beside it', () => {
    const alone: string[] = [];
    for (const { name, lines } of sources) {
      lines.forEach((line, index) => {
        const code = line.trim();
        if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
        const moved = code.match(MOVES);
        if (!moved) return;
        // The partner sits in the same class list: this line, or the one before or after
        // when the list is written over several lines.
        const near = lines.slice(Math.max(0, index - 1), index + 2).join(' ');
        const partner = moved[1]?.startsWith('animate-')
          ? 'motion-reduce:animate-none'
          : 'motion-reduce:transition-none';
        if (!near.includes(partner)) alone.push(`${name}:${index + 1} ${moved[1]}`);
      });
    }
    expect(alone).toEqual([]);
  });

  it('stops the fade on a card and on each kind of row', () => {
    draw(
      <>
        <DiscoverGroup group={SCRIPT_STORY_GROUP} now={NOW} />
        <DiscoverGroup group={SCRIPT_ROW_GROUP} now={NOW} />
        <DiscoverGroup
          group={group('festivals', 'Festivals In India', [festival('Sample Festival')])}
          now={NOW}
          today={TODAY}
        />
        <CompetitorRows items={[competitor('Sample post')]} now={NOW} />
      </>,
    );

    const moving = [
      screen.getAllByRole('article')[0] as HTMLElement,
      screen.getAllByTestId('discover-wiki-row')[0] as HTMLElement,
      screen.getByTestId('discover-festival-row'),
      screen.getByTestId('discover-competitor-row'),
    ];
    for (const node of moving) {
      expect(node).toHaveClass('animate-fadeIn');
      expect(node).toHaveClass('motion-reduce:animate-none');
    }
  });
});
