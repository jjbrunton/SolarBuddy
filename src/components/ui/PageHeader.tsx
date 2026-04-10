import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
}

/*
 * Terminal page header — monospace section marker with eyebrow label,
 * bold uppercase title, and a structural rule separator.
 */
export function PageHeader({
  title,
  description,
  eyebrow = 'SolarBuddy',
  actions,
}: PageHeaderProps) {
  return (
    <header className="relative flex flex-col gap-4 pt-2 pb-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="sb-eyebrow">{eyebrow}</p>
          <h1 className="mt-2 text-2xl font-bold uppercase tracking-[0.02em] text-sb-text sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-3 max-w-2xl text-[0.8rem] leading-6 text-sb-text-muted">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">{actions}</div>
        ) : null}
      </div>
      <div className="sb-rule-strong" />
    </header>
  );
}
