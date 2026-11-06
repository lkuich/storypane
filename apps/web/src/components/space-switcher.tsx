'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Search } from 'lucide-react';
import type { Space } from '@storypane/core';
import { Button, ErrorNotice, Loading, Modal } from '@storypane/ui';
import { errorMessage, requestJson } from '../features/editor/api';
import { groupSpacesForSwitcher } from '../lib/space-environments';
import { EnvironmentBadge } from './environment-badge';

export function SpaceSwitcher({
  current,
  onClose,
  onSelect,
  onAllSpaces,
}: {
  current: Pick<Space, 'id' | 'name' | 'environment' | 'productionSpaceId'>;
  onClose: () => void;
  onSelect: (id: string) => Promise<void>;
  onAllSpaces: () => Promise<void>;
}) {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [switching, setSwitching] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { search.current?.focus(); }, []);
  useEffect(() => {
    let stopped = false;
    setLoading(true);
    setError('');
    void requestJson<Space[]>('/api/spaces')
      .then((result) => {
        if (!stopped) setSpaces(result);
      })
      .catch((cause) => {
        if (!stopped) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!stopped) setLoading(false);
      });
    return () => {
      stopped = true;
    };
  }, [attempt]);
  const groups = groupSpacesForSwitcher(spaces, current);
  const matches = (space: Space) =>
    `${space.name} ${space.environment === 'dev' ? 'Development' : 'Production'}`
      .toLowerCase()
      .includes(query.toLowerCase().trim());
  async function navigate(work: () => Promise<void>) {
    setSwitching(true);
    try {
      await work();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSwitching(false);
    }
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!switching) onClose();
      }}
      title="Switch space"
      description="Linked production and development spaces are grouped together. You'll stay in the same section."
    >
      <label className="search-input space-switch-search">
        <Search aria-hidden="true" />
        <input
          ref={search}
          aria-label="Find a space"
          placeholder="Find a space…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
      </label>
      <ErrorNotice message={error} retry={() => setAttempt((value) => value + 1)} />
      {loading ? (
        <Loading label="Loading spaces…" />
      ) : (
        !error && (
          <div className="space-switch-groups">
            {(['linked', 'other'] as const).map((group) => {
              const matchesGroup = groups[group].filter(matches);
              return matchesGroup.length ? (
                <section
                  key={group}
                  aria-label={group === 'linked' ? 'Linked spaces' : 'Other spaces'}
                >
                  <h3>{group === 'linked' ? 'This project' : 'Other spaces'}</h3>
                  {matchesGroup.map((space) => (
                    <button
                      key={space.id}
                      className="space-switch-option"
                      type="button"
                      aria-label={`Open ${space.name} (${space.environment === 'dev' ? 'Development' : 'Production'})`}
                      aria-current={space.id === current.id ? 'true' : undefined}
                      disabled={switching || space.id === current.id}
                      onClick={() => void navigate(() => onSelect(space.id))}
                    >
                      <EnvironmentBadge environment={space.environment} />
                      <span className="space-switch-name">
                        <strong>{space.name}</strong>
                        <small>
                          {space.id === current.id
                            ? 'You are here'
                            : space.schemaReadOnly
                              ? 'Schema read-only'
                              : space.roleName}
                        </small>
                      </span>
                      {space.id === current.id ? (
                        <Check aria-hidden="true" />
                      ) : (
                        <ArrowRight aria-hidden="true" />
                      )}
                    </button>
                  ))}
                </section>
              ) : null;
            })}
            {![...groups.linked, ...groups.other].some(matches) && <p>No spaces match your search.</p>}
            {!query && groups.linked.length <= 1 && (
              <p className="small muted">No other linked spaces are available to your account.</p>
            )}
          </div>
        )
      )}
      <div className="dialog-actions">
        <Button disabled={switching} onClick={() => void navigate(onAllSpaces)}>
          All spaces
        </Button>
        <Button disabled={switching} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
