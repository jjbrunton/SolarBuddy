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
    <div className={`relative ${editing ? 'rounded-lg ring-1 ring-sb-border ring-dashed' : ''}`}>
      {editing && (
        <div className="flex items-center justify-between rounded-t-lg bg-sb-card/80 px-3 py-1.5">
          <span className="text-xs font-medium text-sb-text-muted">{title}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={onMoveUp}
              disabled={isFirst}
              className="rounded p-1 text-sb-text-muted hover:bg-sb-active hover:text-sb-text disabled:opacity-30"
            >
              <ChevronUp size={14} />
            </button>
            <button
              onClick={onMoveDown}
              disabled={isLast}
              className="rounded p-1 text-sb-text-muted hover:bg-sb-active hover:text-sb-text disabled:opacity-30"
            >
              <ChevronDown size={14} />
            </button>
            <button
              onClick={onHide}
              className="rounded p-1 text-sb-text-muted hover:bg-sb-danger/20 hover:text-sb-danger"
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
