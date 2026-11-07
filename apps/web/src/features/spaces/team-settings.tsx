'use client';
import { useEffect, useState } from 'react';
import { Plus, Users, Trash2 } from 'lucide-react';
import type { SpaceDetails, Team } from '@storypane/core';
import { Button, ErrorNotice, Loading, Modal } from '@storypane/ui';
import { api, errorMessage, jsonRequest } from '../editor/api';

export function TeamSettings({
  space,
  onBusy,
}: {
  space: SpaceDetails;
  onBusy: (busy: boolean) => void;
}) {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [editing, setEditing] = useState<Team | 'new' | null>(null);
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [minimumApprovals, setMinimumApprovals] = useState(1);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canManage = space.role === 'admin';
  async function load() {
    setTeams(await api<Team[]>('/teams'));
  }
  useEffect(() => {
    void load().catch((cause) => setError(errorMessage(cause)));
  }, [space.id]);
  function open(team: Team | 'new') {
    setEditing(team);
    setName(team === 'new' ? '' : team.name);
    setMemberIds(
      team === 'new'
        ? []
        : team.memberIds.filter((id) => space.members.some((member) => member.id === id)),
    );
    setMinimumApprovals(team === 'new' ? 1 : team.minimumApprovals);
    setSearch('');
    setError('');
  }
  async function save(remove = false) {
    if (!editing) return;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      await api(
        `/teams${editing === 'new' ? '' : `/${editing.id}`}`,
        jsonRequest(
          remove ? 'DELETE' : editing === 'new' ? 'POST' : 'PUT',
          remove ? undefined : { name, memberIds, minimumApprovals },
        ),
      );
      await load();
      setEditing(null);
      window.dispatchEvent(new Event('reviews-changed'));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section className="panel" id="teams">
      <header className="panel-heading">
        <h2>
          <Users aria-hidden="true" />
          Teams <span className="pill">{teams?.length ?? 0}</span>
        </h2>
        {canManage && (
          <Button className="button--small" onClick={() => open('new')}>
            <Plus aria-hidden="true" />
            Create team
          </Button>
        )}
      </header>
      <div className="panel-body">
        <p className="muted">
          Bring the right people into a review. Each team sets how many members must approve; roles
          still control their access.
        </p>
        {!editing && (
          <ErrorNotice
            message={error}
            retry={() => void load().catch((cause) => setError(errorMessage(cause)))}
          />
        )}
        {teams === null ? (
          <Loading label="Loading teams…" />
        ) : !teams.length ? (
          <div className="team-empty">
            <Users aria-hidden="true" />
            <div>
              <h3>Good work takes a team.</h3>
              <p className="muted">
                Create teams such as Editorial or Legal, then request their approval from any story
                or block.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-role-list">
            {teams.map((team) => (
              <article className="space-role team-row" key={team.id}>
                <div>
                  <div className="space-role-heading">
                    <h3>{team.name}</h3>
                    <span className="pill pill--outline">
                      {team.minimumApprovals}{' '}
                      {team.minimumApprovals === 1 ? 'approval' : 'approvals'} required
                    </span>
                  </div>
                  <p>
                    {team.memberIds
                      .map(
                        (id) =>
                          space.members.find((member) => member.id === id)?.name ?? 'Former member',
                      )
                      .join(', ')}
                  </p>
                </div>
                {canManage && (
                  <Button className="button--small" onClick={() => open(team)}>
                    Edit team<span className="sr-only"> {team.name}</span>
                  </Button>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
      <Modal
        open={!!editing}
        title={editing === 'new' ? 'Create team' : 'Edit team'}
        onClose={() => {
          if (!busy) setEditing(null);
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <ErrorNotice message={error} />
          <fieldset disabled={busy} className="space-settings-fields">
            <label className="field">
              Team name
              <input
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Editorial"
              />
            </label>
            <fieldset className="review-choices">
              <legend>Team members</legend>
              <input
                type="search"
                aria-label="Search team members"
                placeholder="Search by name or email"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="review-member-list">
                {space.members
                  .filter((member) =>
                    `${member.name} ${member.email}`.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((member) => (
                    <label key={member.id} className="review-choice">
                      <input
                        type="checkbox"
                        checked={memberIds.includes(member.id)}
                        onChange={(event) =>
                          setMemberIds(
                            event.target.checked
                              ? [...memberIds, member.id]
                              : memberIds.filter((id) => id !== member.id),
                          )
                        }
                      />
                      <span>
                        <strong>{member.name}</strong>
                        <small>{member.email}</small>
                      </span>
                    </label>
                  ))}
              </div>
            </fieldset>
            <label className="field">
              Minimum approvals
              <input
                type="number"
                aria-label="Minimum approvals"
                min={1}
                max={Math.max(1, memberIds.length)}
                required
                value={minimumApprovals}
                onChange={(event) => setMinimumApprovals(Number(event.target.value))}
              />
              <span className="field-hint">
                Distinct members with Review content permission must approve. The requester cannot
                approve their own request. Active requests keep their original team and threshold.
              </span>
            </label>
          </fieldset>
          <div className="dialog-actions">
            {editing && editing !== 'new' && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete ${name}? Active reviews keep their assigned team members and approval requirement.`,
                    )
                  )
                    void save(true);
                }}
              >
                <Trash2 aria-hidden="true" />
                Delete team
              </Button>
            )}
            <Button disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={
                busy || !name.trim() || minimumApprovals < 1 || minimumApprovals > memberIds.length
              }
            >
              {busy ? 'Saving…' : 'Save team'}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
