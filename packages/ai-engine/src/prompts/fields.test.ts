import { block, field, readBlock, readField } from './fields';

describe('prompt fields', () => {
  it('round-trips labelled values', () => {
    const text = [
      field('Voice', 'company'),
      field('Max characters per part', 280),
      field('Workspace', null),
    ].join('\n');
    expect(readField(text, 'Voice')).toBe('company');
    expect(readField(text, 'Max characters per part')).toBe('280');
    expect(readField(text, 'Workspace')).toBeNull();
    expect(readField(text, 'Missing')).toBeNull();
  });

  it('round-trips fenced blocks, including multi-line bodies', () => {
    const text = `${block('Brief', 'line one\nline two')}\n${block('Research', '')}`;
    expect(readBlock(text, 'Brief')).toBe('line one\nline two');
    expect(readBlock(text, 'Research')).toBeNull();
    expect(readBlock(text, 'Nope')).toBeNull();
  });

  it('matches whole labels only', () => {
    const text = field('Format', 'one_long');
    expect(readField(text, 'Form')).toBeNull();
  });
});
