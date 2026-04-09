import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'warning' | 'danger';
type ButtonSize = 'sm' | 'md';

/*
 * Terminal buttons — sharp corners, uppercase monospace labels.
 * Primary is orange on black. Secondary is a 1px outline.
 */
const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border-sb-ember bg-sb-ember text-black hover:bg-sb-ember-hover',
  secondary:
    'border-sb-border-strong bg-transparent text-sb-text-muted hover:border-sb-ember hover:text-sb-ember',
  ghost:
    'border-transparent bg-transparent text-sb-text-muted hover:text-sb-ember',
  success:
    'border-sb-success bg-sb-success text-black hover:brightness-110',
  warning:
    'border-sb-warning bg-sb-warning text-black hover:brightness-110',
  danger:
    'border-sb-danger bg-sb-danger text-white hover:brightness-110',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'gap-1.5 px-3 py-1.5 text-[0.7rem] font-semibold tracking-[0.06em]',
  md: 'gap-2 px-4 py-2 text-[0.78rem] font-semibold tracking-[0.04em]',
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
      className={`inline-flex items-center justify-center border uppercase transition-[background-color,border-color,color] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
