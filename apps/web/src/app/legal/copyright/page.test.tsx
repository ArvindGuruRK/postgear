import { render, screen } from '@testing-library/react';
import {
  COPYRIGHT_ADDRESS,
  COPYRIGHT_SECTIONS,
  COPYRIGHT_TITLE,
} from '@/components/legal/copyright-copy';
import CopyrightPage from './page';

describe('/legal/copyright (Module 19)', () => {
  it('names the page and every section', () => {
    render(<CopyrightPage />);
    expect(screen.getByRole('heading', { level: 1, name: COPYRIGHT_TITLE })).toBeInTheDocument();
    for (const section of COPYRIGHT_SECTIONS) {
      expect(screen.getByRole('heading', { level: 2, name: section.heading })).toBeInTheDocument();
    }
  });

  it('gives one address to write to, as a mail link', () => {
    render(<CopyrightPage />);
    const mail = screen.getByRole('link', { name: COPYRIGHT_ADDRESS });
    expect(mail).toHaveAttribute('href', `mailto:${COPYRIGHT_ADDRESS}`);
  });

  it('tells the owner what happens, in the words the workspace sees', () => {
    render(<CopyrightPage />);
    expect(
      screen.getByText(/A video was removed after a request from its owner\./),
    ).toBeInTheDocument();
  });
});
