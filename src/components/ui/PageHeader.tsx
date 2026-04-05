import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
}

/*
 * Editorial page header — eyebrow, Fraunces display title, hairline rule.
 * Replaces the previous rounded-card header so route pages read like an
 * almanac front page rather than a dashboard full of nested boxes.
 */
export function PageHeader({
  title,
  description,
  eyebrow = 'SolarBuddy',
  actions,
}: PageHeaderProps) {
  return (
    <header className="sb-contour relative flex flex-col gap-5 pt-2 pb-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="sb-eyebrow">{eyebrow}</p>
          <h1 className="sb-display mt-3 text-4xl leading-[1.02] text-sb-text sm:text-[3.2rem]">
            {title}
          </h1>
          {description ? (
            <p className="mt-4 max-w-2xl text-sm leading-6 text-sb-text-muted sm:text-[0.95rem]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">{actions}</div>
        ) : null}
      </div>
      <div className="sb-rule" />
    </header>
  );
}
