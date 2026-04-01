import type { ReactNode } from 'react';

type CardTone = 'default' | 'subtle' | 'highlight';
type CardPadding = 'sm' | 'md' | 'lg';

const toneClasses: Record<CardTone, string> = {
  default:
    'border-sb-border bg-sb-card shadow-[var(--shadow-sb-sm)]',
  subtle:
    'border-sb-border/70 bg-sb-surface-muted shadow-none',
  highlight:
    'border-sb-border-strong bg-sb-card shadow-[var(--shadow-sb-glow)]',
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
      className={`rounded-[1.25rem] border ${toneClasses[tone]} ${paddingClasses[padding]} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

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
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h2 className="text-base font-semibold tracking-[-0.01em] text-sb-text">{title}</h2>
        {subtitle ? <p className="text-sm text-sb-text-muted">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}
