'use client';

import { useState } from 'react';
import { LockKeyhole, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  permissions,
  contentScopesSchema,
  type ContentScopes,
  type ContentFolder,
  type Story,
  type SpaceLocale,
  type BlockDefinition,
  type Permission,
  type SpaceRole,
} from '@storypane/core';
import { ContentScopePicker } from './content-scope-picker';
import { Button, ErrorNotice, Modal } from '@storypane/ui';
import { api, errorMessage, jsonRequest } from '../editor/api';

const labels: Record<Permission, string> = {
  'content:read': 'Read content',
  'content:edit': 'Create and edit content',
  'content:publish': 'Publish content',
  'content:review': 'Review content',
  'assets:write': 'Upload and manage assets',
  'schemas:write': 'Manage block schemas',
  'datasources:write': 'Manage datasources',
  'settings:write': 'Manage space settings, locales, and delivery tokens',
};
export function RoleSettings({
  roles,
  canManage,
  onChange,
  onBusy,
}: {
  roles: SpaceRole[];
  canManage: boolean;
  onChange: () => Promise<void>;
  onBusy: (value: boolean) => void;
}) {
  const [editing, setEditing] = useState<SpaceRole | null | undefined>(undefined);
  const [name, setName] = useState(''),
    [selected, setSelected] = useState<Permission[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [scopes, setScopes] = useState<ContentScopes>(() => contentScopesSchema.parse({}));
  const [choices, setChoices] = useState<{
    folders: ContentFolder[];
    stories: Story[];
    locales: SpaceLocale[];
    definitions: BlockDefinition[];
  }>({ folders: [], stories: [], locales: [], definitions: [] });
  async function open(role: SpaceRole | null) {
    setName(role?.name ?? '');
    setSelected(role?.permissions ?? ['content:read']);
    setScopes(role?.contentScopes ?? contentScopesSchema.parse({}));
    setError('');
    setEditing(role);
    setBusy(true);
    try {
      const [folders, stories, locales, definitions] = await Promise.all([
        api<ContentFolder[]>('/folders'),
        api<Story[]>('/stories'),
        api<SpaceLocale[]>('/locales'),
        api<BlockDefinition[]>('/definitions?deployed=true'),
      ]);
      setChoices({ folders, stories, locales, definitions });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function save(method: string, id?: string) {
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      await api(
        `/roles${id ? `/${id}` : ''}`,
        jsonRequest(method, { name, permissions: selected, contentScopes: scopes }),
      );
      await onChange();
      setEditing(undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section className="panel" id="roles">
      <header className="panel-heading">
        <h2>
          <ShieldCheck aria-hidden="true" />
          Roles
        </h2>
        {canManage && (
          <Button className="button--small" disabled={busy} onClick={() => open(null)}>
            <Plus aria-hidden="true" />
            Create role
          </Button>
        )}
      </header>
      <div className="panel-body">
        <p className="muted">
          Roles control which content members can read, edit, and publish. Only Admins manage
          members and roles.
        </p>
        {editing === undefined && <ErrorNotice message={error} />}
        <div className="space-role-list">
          {roles.map((role) => (
            <article className="space-role" key={role.id}>
              <div className="space-role-heading">
                <h3>{role.name}</h3>
                {role.system && (
                  <span className="pill pill--outline">
                    <LockKeyhole aria-hidden="true" />
                    Built-in
                  </span>
                )}
                <span className="muted">
                  {role.memberCount} members
                  {role.invitationCount > 0 ? ` · ${role.invitationCount} pending` : ''}
                </span>
              </div>
              <p>
                {role.id === 'admin'
                  ? 'Full access, including members and roles.'
                  : role.permissions.length
                    ? role.permissions.map((permission) => labels[permission]).join(' · ')
                    : 'No content access or management permissions.'}
              </p>
              {canManage && !role.system && (
                <div className="button-group">
                  <Button className="button--small" disabled={busy} onClick={() => open(role)}>
                    Edit role
                  </Button>
                  <Button
                    variant="ghost"
                    className="button--small"
                    disabled={busy || role.memberCount > 0 || role.invitationCount > 0}
                    title={
                      role.memberCount || role.invitationCount
                        ? 'Reassign members and revoke invitations first.'
                        : 'Delete role'
                    }
                    onClick={() => {
                      if (window.confirm(`Delete the ${role.name} role?`))
                        void save('DELETE', role.id);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                    Delete
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
      <Modal
        open={editing !== undefined}
        title={editing ? `Edit ${editing.name}` : 'Create role'}
        closeOnBackdrop
        onClose={() => {
          if (!busy) setEditing(undefined);
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(editing ? 'PUT' : 'POST', editing?.id);
          }}
        >
          <label className="field">
            Role name
            <input
              autoFocus
              required
              maxLength={80}
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Content author"
            />
          </label>
          <fieldset className="role-permissions" disabled={busy}>
            <legend>Permissions</legend>
            {permissions.map((permission) => (
              <label key={permission}>
                <input
                  type="checkbox"
                  checked={selected.includes(permission)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, permission]
                        : current.filter((item) => item !== permission),
                    )
                  }
                />
                {labels[permission]}
              </label>
            ))}
          </fieldset>
          <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
            <ContentScopePicker
              value={scopes}
              onChange={setScopes}
              enabled={selected}
              {...choices}
            />
          </fieldset>
          <p className="field-hint">
            Unchecked permissions are denied. Changes apply to everyone assigned this role.
          </p>
          <ErrorNotice message={error} />
          <div className="dialog-actions">
            <Button disabled={busy} onClick={() => setEditing(undefined)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : 'Save role'}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
