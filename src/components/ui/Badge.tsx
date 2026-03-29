type BadgeKind = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const kindClasses: Record<BadgeKind, string> = {
  default: 'bg-sb-active text-sb-text-muted',
  primary: 'bg-sb-accent/20 text-sb-accent',
  success: 'bg-sb-success/20 text-sb-success',
  warning: 'bg-sb-warning/20 text-sb-warning',
  danger: 'bg-sb-danger/20 text-sb-danger',
  info: 'bg-sb-info/20 text-sb-info',
};

interface BadgeProps {
  children: React.ReactNode;
  kind?: BadgeKind;
  className?: string;
}

export function Badge({ children, kind = 'default', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${kindClasses[kind]} ${className}`}
    >
      {children}
    </span>
  );
}
