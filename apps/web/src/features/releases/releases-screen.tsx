'use client';
import { visiblePoll } from '../../lib/visible-poll';
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
import {
  ReleasePublicationOptions,
  ReleaseTimeFields,
  releaseTime,
  releaseInstant,
  type PublicationMode,
} from './release-time';

const statusLabel = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  held: 'Needs attention',
  published: 'Published',
  cancelled: 'Cancelled',
};
const releaseViews = { upcoming: 'Upcoming', drafts: 'Drafts', history: 'History' };
type ReleaseView = keyof typeof releaseViews;

function releaseView(item: ContentRelease): ReleaseView {
  if (item.status === 'draft') return 'drafts';
  return item.status === 'published' || item.status === 'cancelled' ? 'history' : 'upcoming';
}

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
  const [view, setView] = useState<ReleaseView>('upcoming');
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
              if (linked) setView(releaseView(linked));
              initialRelease.current = null;
            }
            setReleases(items);
            setError(null);
          }
        })
        .catch((cause) => {
          if (!stopped) setError(errorMessage(cause));
        });
    const poll = visiblePoll(reload, 30_000);
    return () => {
      stopped = true;
      poll.stop();
    };
  }, []);
  const groups = {
    upcoming: (releases ?? [])
      .filter((item) => releaseView(item) === 'upcoming')
      .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? '')),
    drafts: (releases ?? []).filter((item) => releaseView(item) === 'drafts'),
    history: (releases ?? []).filter((item) => releaseView(item) === 'history'),
  };
  const visible = groups[view];
  const release = visible.find((item) => item.id === selected) ?? visible[0];
  const canManageRelease = release?.canManage && view !== 'history';
  function choose(item: ContentRelease | null) {
    setSelected(item?.id ?? null);
    const url = new URL(window.location.href);
    if (item) url.searchParams.set('release', item.id);
    else url.searchParams.delete('release');
    window.history.replaceState(window.history.state, '', url);
  }
  function addContent() {
    choose(release);
    onContent();
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
          <h1>Releases</h1>
          <p>Group approved pages and publish them together.</p>
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
        <div className="release-tabs" role="group" aria-label="Release views">
          {(Object.keys(releaseViews) as ReleaseView[]).map((key) => (
            <Button
              key={key}
              variant={view === key ? 'secondary' : 'ghost'}
              aria-pressed={view === key}
              onClick={() => {
                setView(key);
                choose(null);
              }}
            >
              {releaseViews[key]}
              {key !== 'history' && <span aria-hidden="true">{groups[key].length}</span>}
            </Button>
          ))}
        </div>
      </div>
      {releases === null ? (
        <Loading label="Loading releases…" />
      ) : !visible.length ? (
        <EmptyState
          title={
            {
              upcoming: 'No upcoming releases',
              drafts: 'No draft releases',
              history: 'No past releases',
            }[view]
          }
          children={
            {
              upcoming: 'Scheduled releases and releases that need attention appear here.',
              drafts: 'Start a draft to collect approved pages before setting a publication time.',
              history: 'Published and cancelled releases appear here.',
            }[view]
          }
          action={
            view !== 'history' && canPublish ? (
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
                  {!item.dueAt ? (
                    <Layers size={22} aria-hidden="true" />
                  ) : item.immediate ? (
                    <strong>Now</strong>
                  ) : (
                    <>
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
                    </>
                  )}
                </span>
                <span className="release-card-copy">
                  <strong>{item.name}</strong>
                  <span>
                    {item.items.length} {item.items.length === 1 ? 'page' : 'pages'}
                    {item.dueAt && ' · '}
                    {item.dueAt &&
                      (item.immediate
                        ? 'On approval'
                        : new Date(item.dueAt).toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                            timeZone: item.timezone,
                          }))}
                  </span>
                  <span className="release-status" data-status={item.status}>
                    {item.status === 'held' ? (
                      <CircleAlert size={12} />
                    ) : item.status === 'published' ? (
                      <Check size={12} />
                    ) : item.status === 'scheduled' ? (
                      <CalendarClock size={12} />
                    ) : null}
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
                    {!release.dueAt
                      ? 'No publication time set'
                      : release.immediate
                        ? 'Publication on approval'
                        : `${dateLabel(release.dueAt, release.timezone)} · ${release.timezone}`}
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
                release.status !== 'draft' && (
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
                )
              )}
              <div className="release-items-title">
                <h3>
                  Included pages <span>{release.items.length}</span>
                </h3>
                {canManageRelease && release.items.length > 0 && (
                  <Button className="button--small" onClick={addContent}>
                    <Plus size={15} /> Add content
                  </Button>
                )}
              </div>
              {!release.items.length ? (
                <div className="release-empty">
                  <FileText size={28} />
                  <strong>No pages added yet</strong>
                  {canManageRelease && (
                    <>
                      <p>
                        Choose a page, open its publishing review, and add the approved version to
                        this release.
                      </p>
                      <Button onClick={addContent}>
                        Add content <ArrowRight size={15} />
                      </Button>
                    </>
                  )}
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
                      {canManageRelease && (
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
              {canManageRelease && (
                <div className="release-detail-footer">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      receipt.current = null;
                      setConfirm({ release });
                    }}
                  >
                    Cancel release
                  </Button>
                  <Button
                    variant={release.status === 'draft' ? 'primary' : 'secondary'}
                    onClick={() => setEdit(release)}
                  >
                    {release.status === 'draft' ? (
                      <>
                        <CalendarClock size={16} /> Set publication
                      </>
                    ) : release.status === 'held' ? (
                      'Review & resume'
                    ) : (
                      'Edit release'
                    )}
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
      )}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        className="release-dialog"
        title={
          edit === 'new'
            ? 'New release'
            : edit?.status === 'held'
              ? 'Review and resume release'
              : edit?.status === 'draft'
                ? 'Plan publication'
                : 'Edit release'
        }
      >
        {edit && (
          <ReleaseForm
            key={edit === 'new' ? 'new' : `${edit.id}:${edit.revision}`}
            release={edit === 'new' ? undefined : edit}
            onCancel={() => setEdit(null)}
            onSaved={async (item) => {
              setEdit(null);
              setView(releaseView(item));
              choose(item);
              setReleases((current) => [
                item,
                ...(current ?? []).filter((group) => group.id !== item.id),
              ]);
              await load().catch((cause) => setError(errorMessage(cause)));
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
  const [mode, setMode] = useState<PublicationMode>(release ? 'schedule' : 'draft');
  const [timing, setTiming] = useState(() =>
    releaseTime(release?.dueAt ?? undefined, release?.timezone),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payload = useRef<unknown>(null);
  const dueAt = mode === 'schedule' ? releaseInstant(timing) : undefined;
  const locked = busy || !!payload.current;
  async function save() {
    setBusy(true);
    setError(null);
    try {
      payload.current ??= {
        requestId: crypto.randomUUID(),
        name,
        ...(mode === 'schedule'
          ? { dueAt, timezone: timing.timezone, localTime: timing.localTime }
          : {
              timezone: release?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
              ...(mode === 'draft' ? { draft: true } : { now: true }),
            }),
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
    <form
      className="release-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && name.trim() && (mode !== 'schedule' || dueAt)) void save();
      }}
    >
      <Field label="Release name" htmlFor="release-title">
        <input
          id="release-title"
          ref={nameInput}
          value={name}
          maxLength={120}
          placeholder="e.g. Summer launch"
          disabled={locked}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <fieldset className="release-publication" disabled={locked}>
        <legend>Publication</legend>
        {!release || release.status === 'draft' ? (
          <ReleasePublicationOptions value={mode} onChange={setMode} allowDraft />
        ) : null}
        {mode === 'schedule' ? (
          <ReleaseTimeFields value={timing} onChange={setTiming} disabled={locked} />
        ) : (
          <p className="release-publication-hint">
            {mode === 'draft'
              ? 'Collect approved pages now and choose when to publish later.'
              : release?.items.length
                ? `Queue ${release.items.length} approved ${release.items.length === 1 ? 'page' : 'pages'} for the next publication run.`
                : 'Approved pages are queued for publication as soon as you add them.'}
          </p>
        )}
      </fieldset>
      <ErrorNotice message={error} />
      <div className="dialog-actions">
        <Button disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          disabled={busy || !name.trim() || (mode === 'schedule' && !dueAt)}
        >
          {busy
            ? 'Saving…'
            : payload.current
              ? 'Retry'
              : release?.status === 'held'
                ? 'Resume release'
                : mode === 'draft'
                  ? 'Save draft'
                  : mode === 'now'
                    ? release?.items.length
                      ? 'Publish release'
                      : 'Release now'
                    : !release || release.status === 'draft'
                      ? 'Schedule release'
                      : 'Save release'}
        </Button>
      </div>
    </form>
  );
}
