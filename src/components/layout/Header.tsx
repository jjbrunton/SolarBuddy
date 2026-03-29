'use client';

import { Menu, Sun, Moon } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-sb-border bg-sb-header px-4">
      <button
        onClick={onMenuClick}
        className="text-sb-text-muted hover:text-sb-text lg:hidden"
      >
        <Menu size={20} />
      </button>
      <div className="flex-1" />
      <button
        onClick={toggle}
        className="rounded-md p-2 text-sb-text-muted transition-colors hover:bg-sb-active hover:text-sb-text"
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </header>
  );
}
