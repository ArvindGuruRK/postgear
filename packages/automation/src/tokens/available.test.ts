import { outputFieldsOf } from '../catalog';
import { graphOf, line, step } from '../testing/builders';
import { availableData, lookupField, tokenLabeler } from './available';
import { fallbackLabel, humanise } from './labels';

// Post Published -> If / Else -> (True) A, (False) B -> Merge -> Slack; also Post Published -> C (off)
const branched = graphOf(
  [
    step('trig', 'trigger.postPublished', { name: 'Post Published' }),
    step('cond', 'logic.ifElse', { name: 'Is Instagram' }),
    step('setA', 'logic.setFields', {
      name: 'Set A',
      config: { fields: [{ name: 'note', type: 'text', value: 'A' }] },
    }),
    step('setB', 'logic.setFields', {
      name: 'Set B',
      config: { fields: [{ name: 'note', type: 'text', value: 'B' }] },
    }),
    step('join', 'logic.merge', { name: 'Merge' }),
    step('slak', 'notify.slack', { name: 'Slack' }),
    step('offc', 'logic.setFields', { name: 'Turned Off', disabled: true }),
    step('late', 'notify.inApp', { name: 'Later' }),
  ],
  [
    line('trig', 'cond'),
    line('cond', 'setA', 'true'),
    line('cond', 'setB', 'false'),
    line('setA', 'join'),
    line('setB', 'join'),
    line('join', 'slak'),
    line('trig', 'offc'),
    line('offc', 'join'),
    line('slak', 'late'),
  ],
);

describe('availableData', () => {
  const groups = availableData(branched, 'slak');
  const byTitle = (title: string) => groups.find((group) => group.title === title);

  it('lists only steps that run before this one, then the run and the workspace', () => {
    expect(groups.map((group) => group.title)).toEqual([
      'Post Published',
      'Is Instagram',
      'Turned Off',
      'Set A',
      'Set B',
      'Merge',
      'Run',
      'Workspace',
    ]);
    expect(byTitle('Later')).toBeUndefined();
  });

  it('marks data from a branch that may not have run as "May be empty"', () => {
    expect(byTitle('Set A')).toMatchObject({ maybeEmpty: true, note: 'May be empty' });
    expect(byTitle('Set B')?.maybeEmpty).toBe(true);
    expect(byTitle('Is Instagram')?.maybeEmpty).toBeUndefined();
    expect(byTitle('Post Published')?.maybeEmpty).toBeUndefined();
  });

  it('lists turned-off steps but greys them', () => {
    expect(byTitle('Turned Off')).toMatchObject({
      turnedOff: true,
      note: 'This step is turned off.',
    });
  });

  it('shows the trigger as `trigger` and nests fields as a tree with samples', () => {
    const trigger = byTitle('Post Published');
    expect(trigger?.source).toBe('trigger');
    const post = trigger?.fields.find((field) => field.path === 'trigger.post');
    expect(post?.label).toBe('Post');
    const channel = post?.children.find((field) => field.path === 'trigger.post.channel');
    expect(channel?.children.map((field) => field.label)).toEqual([
      'Channel Id',
      'Channel Name',
      'Platform',
    ]);
    expect(post?.children.find((field) => field.label === 'Post Link')?.sample).toBe(
      'https://instagram.com/p/Cx1',
    );
  });

  it('uses the last test run for samples when it has one', () => {
    const [trigger] = availableData(branched, 'cond', {
      scope: { trigger: { post: { url: 'https://real.example/p/9' } } },
    });
    const url = trigger.fields[0].children.find((field) => field.label === 'Post Link');
    expect(url?.sample).toBe('https://real.example/p/9');
  });

  it('points step fields at the step key, never its name', () => {
    expect(byTitle('Set A')?.fields[0].path).toBe('nodes.setA.output.note');
  });

  it('gives nothing for a step that does not exist', () => {
    expect(availableData(branched, 'nope')).toEqual([]);
  });

  it('treats both sides of a branch rejoining as certain again', () => {
    const rejoin = graphOf(
      [
        step('trig', 'trigger.manual'),
        step('cond', 'logic.ifElse'),
        step('both', 'logic.setFields'),
        step('last', 'notify.inApp'),
      ],
      [
        line('trig', 'cond'),
        line('cond', 'both', 'true'),
        line('cond', 'both', 'false'),
        line('both', 'last'),
      ],
    );
    const both = availableData(rejoin, 'last').find((group) => group.nodeKey === 'both');
    expect(both?.maybeEmpty).toBeUndefined();
  });
});

describe('lookupField', () => {
  const trigger = outputFieldsOf(step('t', 'trigger.postPublished'));
  const webhook = outputFieldsOf(step('w', 'trigger.webhook'));

  it('knows declared fields and their types', () => {
    expect(lookupField(trigger, 'post.url')).toEqual({ known: true, type: 'text' });
    expect(lookupField(trigger, 'post.nope')).toEqual({ known: false });
    expect(lookupField(trigger, '')).toEqual({ known: true, type: 'object' });
  });

  it('lets lists be indexed', () => {
    expect(lookupField(trigger, 'tags.0')).toEqual({ known: true, type: 'text' });
    expect(lookupField(trigger, 'tags.0.x')).toEqual({ known: false });
  });

  it('accepts any path inside data whose shape is not known in advance', () => {
    expect(lookupField(webhook, 'body.title')).toEqual({ known: true });
    expect(lookupField(webhook, 'body.a.b.c')).toEqual({ known: true });
    expect(lookupField(webhook, 'b.c.d.e.f.g.h.i.j')).toEqual({ known: false });
  });
});

describe('labels', () => {
  it('names a token by the label its step declares', () => {
    const label = tokenLabeler(branched);
    expect(label('trigger.post.url')).toBe('Post Link');
    expect(label('nodes.setA.output.note')).toBe('note');
    expect(label('run.startedAt')).toBe('Run Started At');
    expect(label('nodes.gone.output.text')).toBeUndefined();
  });

  it('falls back to readable words made from the path', () => {
    expect(fallbackLabel('trigger.post.channel.name')).toBe('Post Channel Name');
    expect(fallbackLabel('nodes.k1.output.publishedAt')).toBe('Published At');
    expect(fallbackLabel('nodes.k1.output')).toBe('Step Data');
    expect(humanise('post_url')).toBe('Post Url');
  });
});
