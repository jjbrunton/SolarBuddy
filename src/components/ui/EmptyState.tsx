import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="border border-dashed border-sb-border-strong bg-sb-surface-muted px-5 py-12 text-center">
      <p className="text-lg font-bold uppercase tracking-[0.04em] text-sb-text">{title}</p>
      <p className="mx-auto mt-2 max-w-xl text-[0.78rem] leading-6 text-sb-text-muted">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
