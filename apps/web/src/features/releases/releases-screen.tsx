'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CalendarClock,
  Check,
  CheckCheck,
  CircleAlert,
  FileText,
  Layers,
  Plus,
  Trash2,
} from 'lucide-react';
import type { ContentRelease } from '@storypane/core';
import { Button, EmptyState, ErrorNotice, Field, Loading, Modal } from '@storypane/ui';
import { ApiError, api, dateLabel, errorMessage, jsonRequest } from '../editor/api';
import { spaceUrl } from '../../lib/space-url';
import { ReleaseTimeFields, releaseTime, releaseInstant } from './release-time';
import './releases.css';

const statusLabel = {
  scheduled: 'Scheduled',
  held: 'Needs attention',
  published: 'Published',
  cancelled: 'Cancelled',
};
export function ReleasesScreen({
  canPublish,
  onContent,
}: {
  canPublish: boolean;
  onContent: () => void;
}) {
  const [releases, setReleases] = useState<ContentRelease[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(() =>
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('release'),
  );
  const [history, setHistory] = useState(false);
  const initialRelease = useRef(selected);
  const [edit, setEdit] = useState<ContentRelease | 'new' | null>(null);
  const [confirm, setConfirm] = useState<{
    release: ContentRelease;
    item?: ContentRelease['items'][number];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const receipt = useRef<string | null>(null);
  const load = useCallback(async () => {
    const items = await api<ContentRelease[]>('/releases');
    setReleases(items);
    setError(null);
    return items;
  }, []);
  useEffect(() => {
    let stopped = false;
    const reload = () =>
      api<ContentRelease[]>('/releases')
        .then((items) => {
          if (!stopped) {
            if (initialRelease.current) {
              const linked = items.find((item) => item.id === initialRelease.current);
              if (linked) setHistory(['published', 'cancelled'].includes(linked.status));
              initialRelease.current = null;
            }
            setReleases(items);
            setError(null);
          }
        })
        .catch((cause) => {
          if (!stopped) setError(errorMessage(cause));
        });
    void reload();
    const timer = setInterval(() => void reload(), 30000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  const upcoming = (releases ?? [])
    .filter((item) => ['scheduled', 'held'].includes(item.status))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const visible = history
    ? (releases ?? []).filter((item) => !['scheduled', 'held'].includes(item.status))
    : upcoming;
  const release = visible.find((item) => item.id === selected) ?? visible[0];
  function choose(item: ContentRelease) {
    setSelected(item.id);
    const url = new URL(window.location.href);
    url.searchParams.set('release', item.id);
    window.history.replaceState(window.history.state, '', url);
  }
  async function remove() {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    try {
      receipt.current ??= crypto.randomUUID();
      await api(
        confirm.item
          ? `/stories/${confirm.item.storyId}/locales/${confirm.item.localeId}/schedules/${confirm.item.id}`
          : `/releases/${confirm.release.id}`,
        jsonRequest('DELETE', {
          requestId: receipt.current,
          revision: confirm.item?.revision ?? confirm.release.revision,
          ...(confirm.item ? { releaseRevision: confirm.release.revision } : {}),
        }),
      );
      setConfirm(null);
      receipt.current = null;
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="releases-screen">
      <div className="release-page-header">
        <div>
          <p className="release-eyebrow">Plan together. Publish together.</p>
          <h1>Releases</h1>
          <p>
            Approve the pages for your next launch. Keep working without changing what’s scheduled.
          </p>
        </div>
        {canPublish && (
          <Button variant="primary" onClick={() => setEdit('new')}>
            <Plus size={17} />
            New release
          </Button>
        )}
      </div>
      <ErrorNotice
        message={error}
        retry={() => void load().catch((cause) => setError(errorMessage(cause)))}
      />
      <div className="release-toolbar">
        <div className="release-tabs" aria-label="Release views">
          <Button
            variant={!history ? 'primary' : 'ghost'}
            aria-pressed={!history}
            onClick={() => {
              setHistory(false);
              setSelected(null);
            }}
          >
            Upcoming <span>{upcoming.length}</span>
          </Button>
          <Button
            variant={history ? 'primary' : 'ghost'}
            aria-pressed={history}
            onClick={() => {
              setHistory(true);
              setSelected(null);
            }}
          >
            History
          </Button>
        </div>
        <span>
          <Layers size={15} /> One approved version per page and locale
        </span>
      </div>
      {releases === null ? (
        <Loading label="Loading releases…" />
      ) : !visible.length ? (
        <EmptyState
          title={history ? 'No past releases' : 'Make room for your next launch'}
          children={
            history
              ? 'Published and cancelled releases will appear here.'
              : 'Create a release here, or schedule a page from its publishing review. Add more pages as they’re ready.'
          }
          action={
            !history && canPublish ? (
              <Button variant="primary" onClick={() => setEdit('new')}>
                <Plus size={16} />
                Create a release
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="release-layout">
          <div className="release-list" aria-label="Releases">
            {visible.map((item) => (
              <button
                key={item.id}
                className="release-card"
                aria-pressed={release?.id === item.id}
                onClick={() => choose(item)}
              >
                <span className="release-calendar">
                  <span>
                    {new Date(item.dueAt).toLocaleDateString(undefined, {
                      month: 'short',
                      timeZone: item.timezone,
                    })}
                  </span>
                  <strong>
                    {new Date(item.dueAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      timeZone: item.timezone,
                    })}
                  </strong>
                </span>
                <span className="release-card-copy">
                  <strong>{item.name}</strong>
                  <span>
                    {item.items.length} {item.items.length === 1 ? 'page' : 'pages'} ·{' '}
                    {new Date(item.dueAt).toLocaleTimeString(undefined, {
                      hour: 'numeric',
                      minute: '2-digit',
                      timeZone: item.timezone,
                    })}
                  </span>
                  <span className="release-status" data-status={item.status}>
                    {item.status === 'held' ? (
                      <CircleAlert size={12} />
                    ) : item.status === 'published' ? (
                      <Check size={12} />
                    ) : (
                      <CalendarClock size={12} />
                    )}{' '}
                    {item.status === 'scheduled' && item.error
                      ? 'Retrying'
                      : statusLabel[item.status]}
                  </span>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
          {release && (
            <section className="release-detail" aria-label={release.name}>
              <div className="release-detail-heading">
                <span className="release-detail-mark">
                  <Layers />
                </span>
                <div>
                  <span className="release-status" data-status={release.status}>
                    {release.status === 'scheduled' && release.error
                      ? 'Retrying'
                      : statusLabel[release.status]}
                  </span>
                  <h2>{release.name}</h2>
                  <p>
                    {dateLabel(release.dueAt, release.timezone)} · {release.timezone}
                  </p>
                </div>
              </div>
              {release.status === 'held' || release.error ? (
                <div className="release-help release-help--warning">
                  <CircleAlert size={18} />
                  <div>
                    <strong>
                      {release.status === 'held'
                        ? 'Nothing in this release was published.'
                        : 'Publication is delayed. No pages from this attempt went live.'}
                    </strong>
                    <p>
                      {release.error ??
                        'Review the approved pages, then choose a new time to resume.'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="release-help">
                  <CheckCheck size={18} />
                  <div>
                    <strong>
                      {release.status === 'published'
                        ? 'These approved versions went live together.'
                        : release.status === 'cancelled'
                          ? 'This release was cancelled.'
                          : 'Only approved versions will go live.'}
                    </strong>
                    <p>Later edits stay in drafts until you update the release.</p>
                  </div>
                </div>
              )}
              <div className="release-items-title">
                <h3>Approved pages</h3>
                <span>{release.items.length}</span>
              </div>
              {!release.items.length ? (
                <div className="release-empty">
                  <FileText size={28} />
                  <strong>No pages added yet</strong>
                  <p>Open a page, review its saved version, then choose this release.</p>
                  <Button
                    onClick={() => {
                      choose(release);
                      onContent();
                    }}
                  >
                    Choose content <ArrowRight size={15} />
                  </Button>
                </div>
              ) : (
                <ul className="release-items">
                  {release.items.map((item) => (
                    <li key={item.id}>
                      <FileText size={19} />
                      <div>
                        <a
                          href={spaceUrl(
                            `/?story=${item.storyId}&locale=${encodeURIComponent(item.localeSlug)}`,
                          )}
                        >
                          {item.storyName}
                          <ArrowRight size={13} />
                        </a>
                        <p>
                          {item.localeName} · Approved revision {item.checkpointRevision}
                        </p>
                        {item.draftChanged && (
                          <span className="release-draft-note">
                            Newer draft changes are not included
                          </span>
                        )}
                      </div>
                      {release.canManage && ['scheduled', 'held'].includes(release.status) && (
                        <Button
                          variant="ghost"
                          className="icon-button"
                          aria-label={`Remove ${item.storyName} (${item.localeName}) from release`}
                          title="Remove from release"
                          onClick={() => {
                            receipt.current = null;
                            setConfirm({ release, item });
                          }}
                        >
                          <Trash2 size={16} />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {['scheduled', 'held'].includes(release.status) && (
                <div className="release-detail-footer">
                  <Button
                    onClick={() => {
                      choose(release);
                      onContent();
                    }}
                  >
                    <Plus size={15} />
                    Add content
                  </Button>
                  {release.canManage && (
                    <div>
                      <Button onClick={() => setEdit(release)}>
                        {release.status === 'held' ? 'Review & resume' : 'Edit release'}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          receipt.current = null;
                          setConfirm({ release });
                        }}
                      >
                        Cancel release
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      )}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={
          edit === 'new'
            ? 'New release'
            : edit?.status === 'held'
              ? 'Review and resume release'
              : 'Edit release'
        }
        description="Every approved page in this release shares one publication time."
      >
        {edit && (
          <ReleaseForm
            key={edit === 'new' ? 'new' : `${edit.id}:${edit.revision}`}
            release={edit === 'new' ? undefined : edit}
            onCancel={() => setEdit(null)}
            onSaved={async (item) => {
              setEdit(null);
              setHistory(false);
              choose(item);
              await load();
            }}
          />
        )}
      </Modal>
      <Modal
        open={!!confirm}
        onClose={() => {
          if (!busy) {
            setConfirm(null);
            setError(null);
          }
        }}
        title={confirm?.item ? 'Remove page from release?' : 'Cancel this release?'}
        description={
          confirm?.item
            ? `${confirm.item.storyName} (${confirm.item.localeName}) will no longer publish with ${confirm.release.name}. Draft and live content stay as they are. Linked pages may need another review.`
            : `None of the approved pages in ${confirm?.release.name ?? 'this release'} will be published by this release. Draft and live content stay as they are.`
        }
      >
        <ErrorNotice message={error} />
        <div className="dialog-actions">
          <Button
            disabled={busy}
            onClick={() => {
              setConfirm(null);
              setError(null);
            }}
          >
            Keep release
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void remove()}>
            {busy ? 'Saving…' : confirm?.item ? 'Remove page' : 'Cancel release'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
function ReleaseForm({
  release,
  onSaved,
  onCancel,
}: {
  release?: ContentRelease;
  onSaved: (release: ContentRelease) => Promise<void>;
  onCancel: () => void;
}) {
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameInput.current?.focus();
  }, []);
  const [name, setName] = useState(release?.name ?? '');
  const [timing, setTiming] = useState(() => releaseTime(release?.dueAt, release?.timezone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payload = useRef<unknown>(null);
  const dueAt = releaseInstant(timing);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      payload.current ??= {
        requestId: crypto.randomUUID(),
        name,
        dueAt,
        timezone: timing.timezone,
        localTime: timing.localTime,
        ...(release ? { revision: release.revision } : {}),
      };
      const saved = await api<ContentRelease>(
        release ? `/releases/${release.id}` : '/releases',
        jsonRequest(release ? 'PUT' : 'POST', payload.current),
      );
      await onSaved(saved);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code !== 'network' && cause.code !== 'unavailable')
        payload.current = null;
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="release-form">
      <Field label="Release name" htmlFor="release-title">
        <input
          id="release-title"
          ref={nameInput}
          value={name}
          maxLength={120}
          placeholder="e.g. Summer launch"
          disabled={busy || !!payload.current}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <ReleaseTimeFields value={timing} onChange={setTiming} disabled={busy || !!payload.current} />
      <ErrorNotice message={error} />
      <div className="dialog-actions">
        <Button disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy || !name.trim() || !dueAt}
          onClick={() => void save()}
        >
          {busy
            ? 'Saving…'
            : payload.current
              ? 'Retry'
              : release?.status === 'held'
                ? 'Resume release'
                : release
                  ? 'Save release'
                  : 'Create release'}
        </Button>
      </div>
    </div>
  );
}
