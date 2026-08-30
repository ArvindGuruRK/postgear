'use client';

import { Toggle } from '@postgear/ui';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.body.classList.contains('dark'));
  }, []);

  function toggle(checked: boolean) {
    setIsDark(checked);
    document.body.classList.toggle('dark', checked);
    document.body.classList.toggle('light', !checked);
    window.localStorage.setItem('postgear-theme', checked ? 'dark' : 'light');
  }

  return (
    <span className="flex items-center gap-2">
      <Sun className="h-4 w-4 text-ink" strokeWidth={3} />
      <Toggle checked={isDark} onCheckedChange={toggle} aria-label="Toggle dark mode" />
      <Moon className="h-4 w-4 text-ink" strokeWidth={3} />
    </span>
  );
}
