'use client';

import { writeClipboardText } from '../../lib/clipboard';
import { useEffect, useState } from 'react';
import { Check, Copy, Mail, Trash2, UserPlus, Users } from 'lucide-react';
import type { Actor, SpaceDetails, SpaceInvitation, SpaceRole } from '@storypane/core';
import { Button, ErrorNotice, Modal } from '@storypane/ui';
import { ApiError, api, errorMessage, jsonRequest } from '../editor/api';

type Member = SpaceDetails['members'][number];
export function MemberSettings({
  space,
  roles,
  onUpdate,
  onBusy,
}: {
  roles: SpaceRole[];
  space: SpaceDetails;
  onUpdate: (value: SpaceDetails) => void;
  onBusy: (busy: boolean) => void;
}) {
  const canManage = space.role === 'admin';
  const [invitationLink, setInvitationLink] = useState('');
  const [invitations, setInvitations] = useState<SpaceInvitation[]>([]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [adding, setAdding] = useState(false),
    [email, setEmail] = useState(''),
    [role, setRole] = useState<Actor['role']>('editor');
  const [removing, setRemoving] = useState<Member | null>(null);
  async function loadInvitations() {
    try {
      setInvitations(await api<SpaceInvitation[]>('/invitations'));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  useEffect(() => {
    if (canManage) void loadInvitations();
    else setInvitations([]);
  }, [canManage, space.id]);
  async function change(path: string, method: string, body?: unknown) {
    setBusy(true);
    onBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api<{ link?: string }>(path, jsonRequest(method, body));
      if (result.link) setInvitationLink(result.link);
      setAdding(false);
      setRemoving(null);
      // Self-removal/demotion can change which settings are available.
      const updated = await api<SpaceDetails>('/space').catch((cause) => {
        if (cause instanceof ApiError && cause.code === 'forbidden') return null;
        throw cause;
      });
      if (!updated) {
        window.location.assign('/');
        return;
      }
      onUpdate(updated);
      if (updated.role === 'admin') await loadInvitations();
      setMessage(
        method === 'POST'
          ? 'Invitation ready. Copy the invitation link to share it.'
          : 'Member access updated.',
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  async function copyLink() {
    try {
      await writeClipboardText(invitationLink || `${window.location.origin}/?space=${space.id}`);
      setMessage('Link copied.');
    } catch {
      setError('Could not copy the link. Allow clipboard access and try again.');
    }
  }
  const lastAdmin = (member: Member) =>
    member.role === 'admin' && space.members.filter((item) => item.role === 'admin').length === 1;
  return (
    <section className="panel" id="members">
      <header className="panel-heading">
        <h2>
          <Users aria-hidden="true" />
          Members <span className="pill">{space.members.length}</span>
        </h2>
        {canManage && (
          <Button
            className="button--small"
            onClick={() => {
              setEmail('');
              setRole('editor');
              setError('');
              setAdding(true);
            }}
            disabled={busy}
          >
            <UserPlus aria-hidden="true" />
            Add member
          </Button>
        )}
      </header>
      <div className="panel-body">
        <div className="member-intro">
          <p className="muted">
            Assign a role to control each member’s access. Manage permissions in Roles.
          </p>
          {canManage && (
            <Button variant="ghost" className="button--small" onClick={() => void copyLink()}>
              <Copy aria-hidden="true" />
              {invitationLink ? 'Copy invitation link' : 'Copy workspace link'}
            </Button>
          )}
        </div>
        {!adding && !removing && <ErrorNotice message={error} />}
        {message && (
          <p className="member-status" role="status">
            <Check aria-hidden="true" />
            {message}
          </p>
        )}
      </div>
      <div className="table-wrap">
        <table className="data-table" aria-label="Space members">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              {canManage && (
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {space.members.map((member) => (
              <tr key={member.id}>
                <td>
                  <div className="entity-name">
                    <span className="avatar" aria-hidden="true">
                      {member.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <strong>{member.name}</strong>
                      <div className="entity-subtitle">{member.email}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {canManage ? (
                    <select
                      className="member-role"
                      aria-label={`Role for ${member.email}`}
                      value={member.role}
                      disabled={busy || lastAdmin(member)}
                      title={
                        lastAdmin(member)
                          ? 'Promote another administrator before changing this role.'
                          : undefined
                      }
                      onChange={(event) => {
                        const next = event.target.value;
                        if (
                          window.confirm(
                            `Change ${member.name}'s role to ${roles.find((role) => role.id === next)?.name}?`,
                          )
                        )
                          void change(`/members/${encodeURIComponent(member.id)}`, 'PUT', {
                            role: next,
                          });
                      }}
                    >
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="pill pill--outline">
                      {roles.find((role) => role.id === member.role)?.name ?? member.role}
                    </span>
                  )}
                </td>
                {canManage && (
                  <td className="member-action">
                    <Button
                      variant="ghost"
                      className="icon-button"
                      aria-label={`Remove ${member.email}`}
                      disabled={busy || lastAdmin(member)}
                      title={
                        lastAdmin(member)
                          ? 'This space must keep an administrator.'
                          : 'Remove from space'
                      }
                      onClick={() => {
                        setError('');
                        setRemoving(member);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && invitations.length > 0 && (
        <div className="member-invitations">
          <h3>
            Pending invitations <span className="pill">{invitations.length}</span>
          </h3>
          <p className="muted">
            Access starts when they sign in with the invited email. Invitations expire after 7 days.
          </p>
          <ul>
            {invitations.map((invitation) => (
              <li key={invitation.id}>
                <Mail aria-hidden="true" />
                <div>
                  <strong>{invitation.email}</strong>
                  <span>
                    {roles.find((role) => role.id === invitation.role)?.name ?? invitation.role} ·{' '}
                    {new Date(invitation.expiresAt).getTime() <= Date.now()
                      ? 'Expired — revoke and add again'
                      : `Expires ${new Date(invitation.expiresAt).toLocaleDateString()}`}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  className="button--small"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Revoke the invitation for ${invitation.email}?`))
                      void change(`/invitations/${invitation.id}`, 'DELETE');
                  }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Modal
        open={adding}
        title="Add a space member"
        onClose={() => {
          if (!busy) setAdding(false);
        }}
        closeOnBackdrop
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void change('/invitations', 'POST', { email, role });
          }}
        >
          <p className="muted">
            Share the single-use invitation link with this person. It expires in seven days.
            Existing accounts must sign in before accepting.
          </p>
          <label className="field">
            Email address
            <input
              type="email"
              autoFocus
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
              placeholder="teammate@example.com"
            />
          </label>
          <label className="field">
            Role
            <select
              value={role}
              disabled={busy}
              onChange={(event) => setRole(event.target.value as Actor['role'])}
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
          <ErrorNotice message={error} />
          <div className="dialog-actions">
            <Button disabled={busy} onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? 'Adding…' : 'Add member'}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={!!removing}
        title="Remove space member"
        onClose={() => {
          if (!busy) setRemoving(null);
        }}
        closeOnBackdrop
      >
        <p>
          Remove <strong>{removing?.name}</strong> from this space? Their editing access will end.
          Their content and history will stay.
        </p>
        <ErrorNotice message={error} />
        <div className="dialog-actions">
          <Button disabled={busy} onClick={() => setRemoving(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (removing) void change(`/members/${encodeURIComponent(removing.id)}`, 'DELETE');
            }}
          >
            {busy ? 'Removing…' : 'Remove member'}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
