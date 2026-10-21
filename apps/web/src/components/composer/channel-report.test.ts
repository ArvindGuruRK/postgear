import { renderDraftParts } from './channel-report';
import type { DraftPart } from './composer-state';

function part(key: string, text: string): DraftPart {
  return {
    key,
    content: {
      type: 'doc',
      content: text ? [{ type: 'paragraph', content: [{ type: 'text', text }] }] : [],
    },
    media: [],
    removedMedia: 0,
  };
}

describe('renderDraftParts', () => {
  it('gives each part its words, with a plain character count', () => {
    expect(renderDraftParts([part('a', 'Hello there')])).toEqual([
      { key: 'a', text: 'Hello there', media: [], length: 11 },
    ]);
  });

  it('keeps every part of a thread in order', () => {
    const rendered = renderDraftParts([part('a', 'First'), part('b', 'Second')]);

    expect(rendered.map((entry) => entry.text)).toEqual(['First', 'Second']);
  });

  it('is an empty text for a part with nothing written', () => {
    expect(renderDraftParts([part('a', '')])[0]).toMatchObject({ text: '', length: 0 });
  });
});
