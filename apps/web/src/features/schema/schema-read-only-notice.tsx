'use client';

import { useEffect, useId, useState } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { can, type Space } from '@storypane/core';
import { ErrorNotice } from '@storypane/ui';
import type { CMSSession } from '../../components/cms-app';
import { groupSpacesForSwitcher } from '../../lib/space-environments';
import { requestJson } from '../editor/api';

export function SchemaReadOnlyNotice({ space }: { space: CMSSession['space'] }) {
  const headingId = useId();
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stopped = false;
    setSpaces(null);
    setError('');
    void requestJson<Space[]>('/api/spaces')
      .then((result) => {
        if (!stopped) setSpaces(result);
      })
      .catch(() => {
        if (!stopped) setError('Linked development spaces could not be loaded. Please retry.');
      });
    return () => {
      stopped = true;
    };
  }, [space.id, attempt]);
  const linked = groupSpacesForSwitcher(spaces ?? [], space).linked.filter(
    (candidate) =>
      candidate.id !== space.id &&
      candidate.environment === 'dev' &&
      can(candidate, 'schemas:write'),
  );
  const canChangeProtection = space.role === 'admin' && can(space, 'settings:write');
  return (
    <section className="notice schema-read-only-notice" aria-labelledby={headingId}>
      <h3 id={headingId}>
        <LockKeyhole aria-hidden="true" />
        {space.schemaReadOnly ? 'Schema editing is disabled' : 'Schema editing requires access'}
      </h3>
      <p>
        {space.schemaReadOnly
          ? `Schema read-only is enabled for this ${space.environment === 'dev' ? 'development' : 'production'} space. You can inspect the schema, but you can’t change it here.`
          : 'Your role or content access does not allow schema editing in this space. Ask a space administrator for schema editing access.'}
      </p>
      <ErrorNotice message={error} retry={() => setAttempt((value) => value + 1)} />
      {!spaces && !error && <p role="status">Finding linked development spaces…</p>}
      {linked.length > 0 ? (
        <>
          <p>Make changes in a linked development space, then review and promote them.</p>
          <ul>
            {linked.map((dev) => (
              <li key={dev.id}>
                <a
                  className="button"
                  href={`/?${new URLSearchParams({ space: dev.id, view: 'blocks' })}`}
                >
                  <span>Open {dev.name}</span>
                  <ArrowRight aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : spaces ? (
        <>
          <p>No linked development space with schema editing access is available to you.</p>
          {space.schemaReadOnly && (
            <>
              <p>
                {canChangeProtection
                  ? 'To edit here, turn off'
                  : 'A space administrator can turn off'}{' '}
                <strong>Schema read-only</strong> in Space settings → General.
              </p>
              {canChangeProtection && (
                <a
                  className="button"
                  href={`/?${new URLSearchParams({ space: space.id, view: 'settings', section: 'general' })}`}
                >
                  Space settings <ArrowRight aria-hidden="true" />
                </a>
              )}
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
