/**
 * Tamil, Arabic and Japanese samples for the Discover playground (Module 09):
 * one story card and one row in each script, so a script that reads right to
 * left, one that stacks marks, and one with no spaces can all be looked at on
 * the real card and the real row.
 *
 * Every title, paper and address here is invented. Nothing is a real headline.
 */
import type { DiscoverItem, DiscoverGroup as Group } from '@/types/discover';

export interface ScriptSample {
  language: 'ta' | 'ar' | 'ja';
  /** The invented paper the story card names. */
  paper: string;
  /** The story card's headline. */
  story: string;
  /** The row's title. */
  row: string;
}

export const SCRIPT_SAMPLES: readonly ScriptSample[] = [
  {
    language: 'ta',
    paper: 'Sample Tamil Daily',
    story: 'மாதிரி செய்தி: நகரில் புதிய நூலகம் திறப்பு',
    row: 'மாதிரி கட்டுரை',
  },
  {
    language: 'ar',
    paper: 'Sample Arabic Daily',
    story: 'خبر تجريبي: افتتاح مكتبة جديدة في المدينة',
    row: 'مقال تجريبي',
  },
  {
    language: 'ja',
    paper: 'Sample Japanese Daily',
    story: 'サンプル記事：市内に新しい図書館が開館',
    row: 'サンプル項目',
  },
];

function story(sample: ScriptSample): DiscoverItem {
  return {
    id: `demo-script-story-${sample.language}`,
    kind: 'news',
    source: { id: 'google-news', name: sample.paper },
    title: sample.story,
    opaqueUrl: `https://example.com/story/${sample.language}`,
    publishedAt: '2026-11-10T10:00:00Z',
    language: sample.language,
    brief: 'An invented sample story.',
  };
}

function row(sample: ScriptSample, index: number): DiscoverItem {
  return {
    id: `demo-script-row-${sample.language}`,
    kind: 'wiki',
    source: { id: 'wikipedia', name: 'Wikipedia', url: 'https://example.com/wiki' },
    title: sample.row,
    url: `https://example.com/wiki/sample-${sample.language}`,
    language: sample.language,
    signal: { label: `${300 - index * 100} reads` },
    brief: 'An invented sample article.',
  };
}

/** Three story cards, one per script. Any id but the three row groups draws cards. */
export const SCRIPT_STORY_GROUP: Group = {
  id: 'place',
  title: 'Sample Stories In Three Scripts',
  subtitle: 'Invented headlines in Tamil, Arabic and Japanese. None of them is real.',
  attribution: { name: 'Samples' },
  stale: false,
  fetchedAt: '2026-11-10T11:00:00Z',
  items: SCRIPT_SAMPLES.map(story),
};

/** Three rows, one per script, on the Wikipedia row list. */
export const SCRIPT_ROW_GROUP: Group = {
  id: 'wikipedia',
  title: 'Sample Rows In Three Scripts',
  subtitle: 'Invented article names in Tamil, Arabic and Japanese. None of them is real.',
  attribution: { name: 'Samples' },
  stale: false,
  fetchedAt: '2026-11-10T06:00:00Z',
  items: SCRIPT_SAMPLES.map(row),
};
