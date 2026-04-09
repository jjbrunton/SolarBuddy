type BadgeKind = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

/*
 * Terminal status badge — sharp corners, monospace uppercase,
 * with a coloured left border accent for quick visual scanning.
 */
const kindClasses: Record<BadgeKind, string> = {
  default: 'border-sb-text-subtle/40 bg-sb-surface-muted text-sb-text-muted',
  primary: 'border-sb-ember/50 bg-sb-ember/10 text-sb-ember',
  success: 'border-sb-success/50 bg-sb-success/10 text-sb-success',
  warning: 'border-sb-warning/50 bg-sb-warning/10 text-sb-warning',
  danger: 'border-sb-danger/50 bg-sb-danger/10 text-sb-danger',
  info: 'border-sb-frost/50 bg-sb-frost/10 text-sb-frost',
};

interface BadgeProps {
  children: React.ReactNode;
  kind?: BadgeKind;
  className?: string;
}

export function Badge({ children, kind = 'default', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center border px-2 py-[0.15rem] text-[0.6rem] font-semibold uppercase tracking-[0.14em] ${kindClasses[kind]} ${className}`}
    >
      {children}
    </span>
  );
}
