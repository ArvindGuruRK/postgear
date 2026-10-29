import { render, screen } from '@testing-library/react';
import { NoteText, safeLink } from './note-text';

describe('NoteText', () => {
  it('renders bold, italic, links and lists', () => {
    const { container } = render(
      <NoteText
        text={'Check **Monday** and *Friday*\n- one\n- [two](https://postgear.rkay.in/a)'}
      />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('Monday');
    expect(container.querySelector('em')?.textContent).toBe('Friday');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'two' }).getAttribute('href')).toBe(
      'https://postgear.rkay.in/a',
    );
  });

  it('never renders HTML or unsafe links', () => {
    const { container } = render(
      <NoteText text={'<img src=x onerror=alert(1)> [click](javascript:alert(1))'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('mailto:a@b.c')).toBeNull();
  });
});
