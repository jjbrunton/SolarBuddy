'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface CollapsibleSectionProps {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  badge?: number;
  children: React.ReactNode;
}

export function CollapsibleSection({
  title,
  description,
  defaultOpen = false,
  badge,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-[0.8rem] font-semibold uppercase tracking-[0.04em] text-sb-text">
            {title}
          </h3>
          {badge != null && badge > 0 && (
            <span className="bg-sb-ember/15 px-2 py-0.5 text-[0.6rem] font-medium uppercase text-sb-ember">
              {badge}
            </span>
          )}
        </div>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className={`text-sb-text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {description && !open && (
        <p className="-mt-2 mb-1 text-[0.7rem] text-sb-text-muted">{description}</p>
      )}
      {open && <div className="pb-4 pt-1">{children}</div>}
    </div>
  );
}
