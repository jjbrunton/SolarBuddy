import type { ReactNode } from 'react';

type CardTone = 'default' | 'subtle' | 'highlight';
type CardPadding = 'sm' | 'md' | 'lg';

/*
 * Editorial surfaces — depth comes from hairline borders and a small
 * amount of background tint, never from drop shadows. The highlight
 * tone gets a 1px ember focus ring to mark the current selection.
 */
const toneClasses: Record<CardTone, string> = {
  default: 'border-sb-border bg-sb-card',
  subtle: 'border-sb-border/70 bg-sb-surface-muted',
  highlight: 'border-sb-ember/50 bg-sb-card shadow-[0_0_0_1px_var(--color-sb-ember)]',
};

const paddingClasses: Record<CardPadding, string> = {
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  tone?: CardTone;
  padding?: CardPadding;
}

export function Card({
  children,
  className = '',
  onClick,
  tone = 'default',
  padding = 'md',
}: CardProps) {
  return (
    <div
      className={`rounded-[0.75rem] border ${toneClasses[tone]} ${paddingClasses[padding]} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

/*
 * CardHeader — the title uses Fraunces at a modest size for editorial
 * consistency with PageHeader without competing with it.
 */
export function CardHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-sb-rule pb-4">
      <div className="space-y-1">
        <h2 className="sb-display text-xl text-sb-text">{title}</h2>
        {subtitle ? <p className="text-sm text-sb-text-muted">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}
