'use client';

import { ArrowRight, CheckCircle2, LockKeyhole } from 'lucide-react';
import { migrationChanges, type SchemaMigration } from '@storypane/core';
import { Button, ErrorNotice, Modal } from '@storypane/ui';
import { MigrationDiff } from './migration-diff';

export function MigrationHistoryDialog({
  migration,
  base,
  people,
  onClose,
}: {
  migration: SchemaMigration;
  base?: SchemaMigration;
  people: Record<string, string>;
  onClose: () => void;
}) {
  const person = (id: string) => people[id] ?? id;
  return (
    <Modal
      open
      wide
      className="migration-dialog"
      title={`Migration ${migration.version}`}
      description={migration.name}
      onClose={onClose}
    >
      <div className="migration-review">
        <div className="migration-history-overview">
          <div className="migration-version">
            <span>Deployed release</span>
            <div>
              <span>v{migration.baseVersion}</span>
              <ArrowRight size={18} aria-hidden="true" />
              <strong>v{migration.version}</strong>
            </div>
          </div>
          <span className="pill pill--green">
            <CheckCircle2 size={13} aria-hidden="true" />
            Deployed
          </span>
        </div>
        <dl className="migration-history-meta">
          <div>
            <dt>Deployed</dt>
            <dd>
              {migration.deployedAt ? (
                <time dateTime={migration.deployedAt}>
                  {new Date(migration.deployedAt).toLocaleString()}
                </time>
              ) : (
                'Date unavailable'
              )}
            </dd>
          </div>
          <div>
            <dt>Deployed by</dt>
            <dd>{migration.deployedBy ? person(migration.deployedBy) : 'Setup'}</dd>
          </div>
          <div>
            <dt>Contributors</dt>
            <dd>{migration.contributors.map(person).join(', ') || 'Setup'}</dd>
          </div>
          <div>
            <dt>Deployment</dt>
            <dd className={migration.destructive ? 'migration-history-destructive' : undefined}>
              {migration.destructive ? 'Destructive' : 'Standard'}
            </dd>
          </div>
        </dl>
        {base ? (
          <MigrationDiff
            changes={migrationChanges(base.definitions, migration.definitions)}
            expandFirst
            emptyMessage="This deployment recorded a schema version without changing its definitions."
          />
        ) : (
          <ErrorNotice
            message={`Base migration ${migration.baseVersion} is unavailable. The diff cannot be shown.`}
          />
        )}
      </div>
      <footer className="migration-review-footer">
        <p>
          <LockKeyhole size={13} aria-hidden="true" /> Deployed migrations are read-only.
        </p>
        <Button onClick={onClose}>Close</Button>
      </footer>
    </Modal>
  );
}
