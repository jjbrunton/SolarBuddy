type BadgeKind = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const kindClasses: Record<BadgeKind, string> = {
  default: 'border-sb-border bg-sb-surface-muted text-sb-text-muted',
  primary: 'border-sb-accent/30 bg-sb-accent/12 text-sb-accent',
  success: 'border-sb-success/30 bg-sb-success/12 text-sb-success',
  warning: 'border-sb-warning/30 bg-sb-warning/14 text-sb-warning',
  danger: 'border-sb-danger/30 bg-sb-danger/14 text-sb-danger',
  info: 'border-sb-info/30 bg-sb-info/14 text-sb-info',
};

interface BadgeProps {
  children: React.ReactNode;
  kind?: BadgeKind;
  className?: string;
}

export function Badge({ children, kind = 'default', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] ${kindClasses[kind]} ${className}`}
    >
      {children}
    </span>
  );
}
