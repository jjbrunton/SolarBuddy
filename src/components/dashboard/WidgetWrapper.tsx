'use client';

import { ChevronUp, ChevronDown, EyeOff } from 'lucide-react';

interface WidgetWrapperProps {
  id: string;
  title: string;
  editing: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onHide: () => void;
  children: React.ReactNode;
}

export function WidgetWrapper({
  title,
  editing,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onHide,
  children,
}: WidgetWrapperProps) {
  return (
    <div className={`relative ${editing ? 'rounded-[1.25rem] ring-1 ring-dashed ring-sb-border-strong' : ''}`}>
      {editing && (
        <div className="flex items-center justify-between rounded-t-[1.25rem] border-b border-sb-border bg-sb-card/90 px-4 py-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">{title}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={onMoveUp}
              disabled={isFirst}
              className="rounded-lg p-1.5 text-sb-text-muted hover:bg-sb-active hover:text-sb-text disabled:opacity-30"
            >
              <ChevronUp size={14} />
            </button>
            <button
              onClick={onMoveDown}
              disabled={isLast}
              className="rounded-lg p-1.5 text-sb-text-muted hover:bg-sb-active hover:text-sb-text disabled:opacity-30"
            >
              <ChevronDown size={14} />
            </button>
            <button
              onClick={onHide}
              className="rounded-lg p-1.5 text-sb-text-muted hover:bg-sb-danger/20 hover:text-sb-danger"
            >
              <EyeOff size={14} />
            </button>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
