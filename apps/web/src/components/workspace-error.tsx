'use client';

import { ArrowLeft, Boxes, RefreshCw, Unplug } from 'lucide-react';
import { Button } from '@storypane/ui';
import { ThemePicker } from './theme-picker';

export function WorkspaceError({
  message,
  onRetry,
  retrying = false,
  title = 'Unable to open this workspace',
  showSpaces = true,
}: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
  title?: string;
  showSpaces?: boolean;
}) {
  return (
    <div className="workspace-error">
      <header className="workspace-error-header">
        <a className="brand-lockup" href="/" aria-label="Storypane home">
          <span className="brand-mark">
            <Boxes aria-hidden="true" />
          </span>
          <span className="brand-name">
            storypane<span className="brand-period">.</span>
          </span>
        </a>
        <ThemePicker />
      </header>
      <main className="workspace-error-main" aria-labelledby="workspace-error-title">
        <section className="workspace-error-card">
          <div className="workspace-error-symbol" aria-hidden="true">
            <Unplug />
          </div>
          <span className="eyebrow">Workspace unavailable</span>
          <h1 id="workspace-error-title">{title}</h1>
          <p className="workspace-error-message" role="alert">
            {message}
          </p>
          <div className="workspace-error-actions">
            <Button variant="primary" onClick={onRetry} disabled={retrying}>
              {retrying ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              {retrying ? 'Reconnecting…' : 'Try again'}
            </Button>
            {showSpaces && (
              <a href="/" className="button">
                <ArrowLeft aria-hidden="true" />
                All spaces
              </a>
            )}
          </div>
          <p className="workspace-error-help" role="status">
            {retrying
              ? 'Checking your connection to the workspace…'
              : showSpaces
                ? 'Try again, or return to your spaces to choose another workspace.'
                : 'Try again to reconnect to Storypane.'}
          </p>
        </section>
      </main>
    </div>
  );
}
