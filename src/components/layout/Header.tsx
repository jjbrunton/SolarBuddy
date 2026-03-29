'use client';

import { Menu } from 'lucide-react';

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-sb-border bg-sb-header px-4">
      <button
        onClick={onMenuClick}
        className="text-sb-text-muted hover:text-sb-text lg:hidden"
      >
        <Menu size={20} />
      </button>
      <div className="flex-1" />
    </header>
  );
}
