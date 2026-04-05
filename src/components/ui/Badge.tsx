type BadgeKind = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

/*
 * Editorial chip — ember is the primary state because ember is the
 * brand colour. Success/warning/danger stay in their semantic lanes
 * and only appear for real state changes, never decoration.
 */
const kindClasses: Record<BadgeKind, string> = {
  default: 'border-sb-rule bg-sb-surface-muted text-sb-text-muted',
  primary: 'border-sb-ember/40 bg-sb-ember/12 text-sb-ember',
  success: 'border-sb-success/40 bg-sb-success/12 text-sb-success',
  warning: 'border-sb-warning/40 bg-sb-warning/14 text-sb-warning',
  danger: 'border-sb-danger/40 bg-sb-danger/14 text-sb-danger',
  info: 'border-sb-frost/40 bg-sb-frost/12 text-sb-frost',
};

interface BadgeProps {
  children: React.ReactNode;
  kind?: BadgeKind;
  className?: string;
}

export function Badge({ children, kind = 'default', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-[0.2rem] text-[0.66rem] font-semibold uppercase tracking-[0.18em] ${kindClasses[kind]} ${className}`}
    >
      {children}
    </span>
  );
}
