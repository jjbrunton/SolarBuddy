import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
}

export function PageHeader({
  title,
  description,
  eyebrow = 'SolarBuddy',
  actions,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 rounded-[1.75rem] border border-sb-border bg-sb-card/70 px-5 py-5 shadow-[var(--shadow-sb-sm)] sm:px-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-sb-text-subtle">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-sb-text sm:text-[2rem]">
          {title}
        </h1>
        {description ? <p className="mt-2 text-sm leading-6 text-sb-text-muted sm:text-[0.95rem]">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
