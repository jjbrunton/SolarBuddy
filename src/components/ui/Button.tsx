import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'warning' | 'danger';
type ButtonSize = 'sm' | 'md';

/*
 * Editorial buttons — the primary variant is the ember brand colour
 * on warm ink text; secondary is a hairline outline; ghost is a plain
 * inline affordance. Corners are tight (0.5rem) to match Card.
 */
const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-sb-ember text-sb-ember-char hover:bg-sb-ember-hover',
  secondary:
    'border-sb-rule-strong bg-transparent text-sb-text-muted hover:border-sb-ember/60 hover:text-sb-text',
  ghost:
    'border-transparent bg-transparent text-sb-text-muted hover:text-sb-ember',
  success:
    'border-transparent bg-sb-success text-sb-parchment hover:brightness-110',
  warning:
    'border-transparent bg-sb-warning text-sb-parchment hover:brightness-110',
  danger:
    'border-transparent bg-sb-danger text-white hover:brightness-110',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'gap-1.5 px-3 py-1.5 text-[0.78rem] font-semibold tracking-[0.02em]',
  md: 'gap-2 px-4 py-2 text-[0.85rem] font-semibold tracking-[0.02em]',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-[0.5rem] border uppercase transition-[background-color,border-color,color,transform] duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
