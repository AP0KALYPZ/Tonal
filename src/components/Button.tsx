import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  children?: ReactNode;
  block?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  block,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size}${block ? ' btn-block' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {icon ? <span className="btn-icon" aria-hidden="true">{icon}</span> : null}
      {children ? <span className="btn-label">{children}</span> : null}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  active?: boolean;
  size?: 'sm' | 'md';
}

export function IconButton({ label, icon, active, size = 'md', className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={`icon-btn icon-btn-${size}${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      {...rest}
    >
      {icon}
    </button>
  );
}
