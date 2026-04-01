import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'warning' | 'danger';
type ButtonSize = 'sm' | 'md';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-sb-accent text-white hover:bg-sb-accent-hover',
  secondary:
    'border-sb-border bg-sb-card text-sb-text-muted hover:border-sb-border-strong hover:bg-sb-active hover:text-sb-text',
  ghost:
    'border-transparent bg-transparent text-sb-text-muted hover:bg-sb-active/70 hover:text-sb-text',
  success:
    'border-transparent bg-sb-success text-sb-bg hover:brightness-105',
  warning:
    'border-transparent bg-sb-warning text-sb-bg hover:brightness-105',
  danger:
    'border-transparent bg-sb-danger text-white hover:brightness-105',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'gap-1.5 px-3 py-1.5 text-sm',
  md: 'gap-2 px-4 py-2 text-sm',
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
      className={`inline-flex items-center justify-center rounded-xl border font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
