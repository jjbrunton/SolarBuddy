import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-[1.25rem] border border-dashed border-sb-border-strong bg-sb-surface-muted px-5 py-10 text-center">
      <p className="text-base font-semibold text-sb-text">{title}</p>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-sb-text-muted">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
