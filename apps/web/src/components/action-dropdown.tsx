'use client';

import type { ReactNode } from 'react';

export function ActionDropdown({
  label,
  icon,
  text,
  children,
  disabled = false,
  primary = false,
}: {
  label: string;
  icon: ReactNode;
  text?: string;
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
        className={`button button--${primary ? 'primary' : 'ghost'} ${text ? 'action-dropdown-text' : 'icon-button'}`}
        aria-label={label}
        aria-disabled={disabled || undefined}
        title={label}
        tabIndex={disabled ? -1 : 0}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        {icon}
        {text}
      </summary>
      {/* Keep focus inside on mouse-down until a clicked label activates its checkbox. */}
      <div className="action-dropdown-menu" role="group" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </details>
  );
}
