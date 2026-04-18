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
    <header className="relative flex flex-col gap-3 pt-1 pb-4 sm:gap-4 sm:pt-2 sm:pb-5">
      <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 max-w-3xl">
          <p className="sb-eyebrow">{eyebrow}</p>
          <h1 className="mt-2 text-xl font-bold uppercase tracking-[0.02em] text-sb-text sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-[0.8rem] leading-6 text-sb-text-muted sm:mt-3">
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
