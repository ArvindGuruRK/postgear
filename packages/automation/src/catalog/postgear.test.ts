/**
 * The PostGear steps' settings and panels (Module 10): library picks next
 * to media from earlier steps, the "text or media" rule, and the fields
 * the web builds against.
 */
import { graphOf, line, step } from '../testing/builders';
import { validateGraph } from '../validate/validate-graph';
import { fieldSpecFor, isFieldShown } from './form';
import { getDefinition } from './index';
import type { NodeDefinition, NodeType } from './types';

const MEDIA_ID = '6f1c2f7e-5d2b-4d0c-9a4e-3b8f0e2a1c11';
const POSTING: NodeType[] = ['postgear.createDraft', 'postgear.addToQueue', 'postgear.publish'];

const def = (type: NodeType) => getDefinition(type) as NodeDefinition;

function missing(type: NodeType, config: Record<string, unknown>): string[] {
  const graph = graphOf(
    [step('start', 'trigger.manual'), step('target', type, { config })],
    [line('start', 'target')],
  );
  return validateGraph(graph, {
    connections: [],
    channels: [{ id: 'ch_ig', name: 'Bloom Bakery', provider: 'instagram', status: 'active' }],
  })
    .filter((issue) => issue.nodeKey === 'target' && issue.code === 'node.required_missing')
    .map((issue) => issue.field as string);
}

describe.each(POSTING)('%s', (type) => {
  const schema = def(type).configSchema;
  const base = { ...(def(type).defaultConfig as Record<string, unknown>), channels: ['ch_ig'] };

  it('takes up to ten media library ids next to the media template', () => {
    expect(schema.safeParse({ ...base, mediaIds: [MEDIA_ID] }).success).toBe(true);
    expect(schema.safeParse({ ...base, mediaIds: ['not-a-uuid'] }).success).toBe(false);
    expect(schema.safeParse({ ...base, mediaIds: Array(11).fill(MEDIA_ID) }).success).toBe(false);
    expect(schema.safeParse({ ...base, mediaIds: undefined }).success).toBe(true);
  });

  it('asks for text or media, and a library pick counts as media', () => {
    expect(missing(type, { ...base, text: '', media: '' })).toContain('text');
    expect(missing(type, { ...base, text: 'Hello', media: '' })).not.toContain('text');
    expect(missing(type, { ...base, text: '', media: '{{ trigger.post.id }}' })).not.toContain(
      'text',
    );
    expect(missing(type, { ...base, text: '', media: '', mediaIds: [MEDIA_ID] })).not.toContain(
      'text',
    );
    expect(missing(type, { ...base, channels: [], text: 'Hi' })).toContain('channels');
  });

  it('edits media with the media field, library picks in mediaIds', () => {
    const media = fieldSpecFor(def(type), 'media');
    expect(media?.spec).toMatchObject({
      kind: 'media',
      libraryPath: 'mediaIds',
      acceptsData: true,
    });
    expect(fieldSpecFor(def(type), 'mediaIds')?.spec.path).toBe('media');
    expect(fieldSpecFor(def(type), 'channels')?.tab).toBe('setup');
  });
});

describe('Add To Queue', () => {
  const queue = def('postgear.addToQueue');
  const base = { ...(queue.defaultConfig as Record<string, unknown>), channels: ['ch_ig'] };

  it('asks for a time only when posting at a chosen time', () => {
    expect(missing('postgear.addToQueue', { ...base, text: 'Hi', when: 'nextSlot' })).toEqual([]);
    expect(missing('postgear.addToQueue', { ...base, text: 'Hi', when: 'at', at: '' })).toEqual([
      'at',
    ]);
  });

  it('shows the time field only for a chosen time, and picks a time zone', () => {
    const at = fieldSpecFor(queue, 'at')?.spec;
    expect(at).toMatchObject({ kind: 'text', acceptsData: true });
    expect(at?.placeholder).toBe('Enter your date and time');
    expect(at && isFieldShown(at, { when: 'nextSlot' })).toBe(false);
    expect(at && isFieldShown(at, { when: 'at' })).toBe(true);
    expect(fieldSpecFor(queue, 'when')?.spec.kind).toBe('select');
    expect(fieldSpecFor(queue, 'timeZone')?.spec.kind).toBe('timeZone');
  });
});

describe('Publish To', () => {
  const publish = def('postgear.publish');

  it('limits channels and settings to the card’s platform', () => {
    expect(fieldSpecFor(publish, 'channels')?.spec).toMatchObject({
      kind: 'channels',
      providerPath: 'provider',
    });
    expect(fieldSpecFor(publish, 'settings')?.spec).toMatchObject({
      kind: 'providerSettings',
      providerPath: 'provider',
    });
  });

  it('says to use Post Published for the post link', () => {
    expect(publish.form?.notes?.some((note) => note.includes('Post Published'))).toBe(true);
  });
});

describe('Get Post', () => {
  it('takes the post as text that accepts data', () => {
    const getPost = def('postgear.getPost');
    expect(fieldSpecFor(getPost, 'post')?.spec).toMatchObject({ kind: 'text', acceptsData: true });
    expect(missing('postgear.getPost', { post: '' })).toEqual(['post']);
    expect(missing('postgear.getPost', { post: '{{ trigger.post.id }}' })).toEqual([]);
  });
});
