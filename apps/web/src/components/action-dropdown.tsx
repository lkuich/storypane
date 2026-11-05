'use client';

import type { ReactNode } from 'react';

export function ActionDropdown({
  label,
  icon,
  children,
  disabled = false,
  primary = false,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <details
      className="action-dropdown"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && event.currentTarget.open) {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}
      onClick={(event) => {
        if ((event.target as Element).closest('button')) {
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}
    >
      <summary
        role="button"
        className={`button button--${primary ? 'primary' : 'ghost'} icon-button`}
        aria-label={label}
        aria-disabled={disabled || undefined}
        title={label}
        tabIndex={disabled ? -1 : 0}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        {icon}
      </summary>
      <div className="action-dropdown-menu" role="group" aria-label={label}>
        {children}
      </div>
    </details>
  );
}
