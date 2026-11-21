'use client';
import { visiblePoll } from '../../lib/visible-poll';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CalendarClock, CircleAlert, Layers, Zap } from 'lucide-react';
import type {
  CheckpointDetail,
  ContentRelease,
  PublicationSchedule,
  PublicationReferenceChoice,
} from '@storypane/core';
import { Button, ErrorNotice, Field } from '@storypane/ui';
import { ApiError, api, dateLabel, errorMessage, jsonRequest } from './api';
import { spaceUrl } from '../../lib/space-url';
import {
  ReleasePublicationOptions,
  ReleaseTimeFields,
  releaseTime,
  releaseInstant,
  type PublicationMode,
} from '../releases/release-time';

export function PublicationSchedules({
  base,
  revision,
  refresh,
  canPublish,
  onReview,
  onUpdate,
  onChange,
  readOnly = false,
}: {
  base: string;
  revision: number;
  refresh: number;
  canPublish: boolean;
  onReview: (id: string) => void;
  onUpdate: () => void;
  onChange?: (schedule: PublicationSchedule | null) => void;
  readOnly?: boolean;
}) {
  const change = useRef(onChange);
  change.current = onChange;
  const [schedules, setSchedules] = useState<PublicationSchedule[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    const load = () =>
      api<PublicationSchedule[]>(`${base}/schedules`)
        .then((items) => {
          if (!stopped) {
            setSchedules(items);
            change.current?.(items.find((item) => item.active) ?? null);
            setError(null);
          }
        })
        .catch((cause) => {
          if (!stopped) {
            setError(errorMessage(cause));
            setSchedules([]);
            change.current?.(null);
          }
        });
    const poll = visiblePoll(load, 30_000);
    return () => {
      stopped = true;
      poll.stop();
    };
  }, [base, revision, refresh]);
  const scheduled = schedules.find((item) => item.active);
  return (
    <>
      <ErrorNotice message={error} />
      {scheduled && (
        <section
          className="release-banner"
          data-held={scheduled.releaseStatus === 'held' || undefined}
          aria-label={scheduled.releaseStatus === 'draft' ? 'Draft release' : 'Scheduled release'}
        >
          <span className="release-banner-icon">
            {scheduled.releaseStatus === 'draft' ? (
              <Layers />
            ) : scheduled.releaseStatus === 'held' ? (
              <CircleAlert />
            ) : (
              <CalendarClock />
            )}
          </span>
          <div className="release-banner-copy">
            <span className="release-eyebrow">
              {scheduled.releaseStatus === 'draft'
                ? 'In a draft release'
                : scheduled.releaseStatus === 'held'
                  ? 'Release needs attention'
                  : 'In an upcoming release'}
            </span>
            <strong>{scheduled.releaseName}</strong>
            <p>
              {scheduled.dueAt
                ? `${dateLabel(scheduled.dueAt, scheduled.timezone)} · ${scheduled.timezone}`
                : 'No publication time set'}{' '}
              ·{' '}
              <button
                disabled={readOnly}
                className="release-text-button"
                onClick={() => onReview(scheduled.checkpointId)}
              >
                Approved revision {scheduled.checkpointRevision}
              </button>
            </p>
            {revision > scheduled.checkpointRevision && (
              <p className="release-draft-note">
                Newer draft edits are not included. Review them to update this release.
              </p>
            )}
            {scheduled.error && <p className="release-draft-note">{scheduled.error}</p>}
          </div>
          <div className="release-banner-actions">
            {canPublish && !readOnly && (
              <Button className="button--small" onClick={onUpdate}>
                Update release
              </Button>
            )}
            <a
              className="button button--ghost button--small"
              href={spaceUrl(`/?view=releases&release=${scheduled.releaseId}`)}
            >
              View release <ArrowUpRight size={15} />
            </a>
          </div>
        </section>
      )}
    </>
  );
}

export function ScheduleForm({
  base,
  checkpoint,
  referenceChoices,
  onScheduled,
  onCancel,
}: {
  base: string;
  checkpoint: CheckpointDetail;
  referenceChoices: PublicationReferenceChoice[];
  onScheduled: () => void;
  onCancel: () => void;
}) {
  const [timing, setTiming] = useState(() => releaseTime());
  const [mode, setMode] = useState<PublicationMode>('schedule');
  const [name, setName] = useState(`${checkpoint.snapshot.story.name} release`.slice(0, 120));
  const [releases, setReleases] = useState<ContentRelease[]>([]);
  const [selected, setSelected] = useState('new');
  const [existing, setExisting] = useState<PublicationSchedule | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payload = useRef<unknown>(null);
  const releaseSelect = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (loaded) releaseSelect.current?.focus();
  }, [loaded]);
  useEffect(() => {
    let stopped = false;
    setLoaded(false);
    Promise.all([
      api<PublicationSchedule[]>(`${base}/schedules`),
      api<ContentRelease[]>('/releases'),
    ])
      .then(([items, groups]) => {
        if (stopped) return;
        const current = items.find((item) => item.active) ?? null;
        const available = groups.filter(
          (group) => group.canManage && ['draft', 'scheduled', 'held'].includes(group.status),
        );
        setExisting(current);
        setReleases(available);
        const requested = new URLSearchParams(window.location.search).get('release');
        setSelected(
          available.some((item) => item.id === requested)
            ? requested!
            : available.some((item) => item.id === current?.releaseId)
              ? current!.releaseId
              : 'new',
        );
        setLoaded(true);
      })
      .catch((cause) => {
        if (!stopped) setError(errorMessage(cause));
      });
    return () => {
      stopped = true;
    };
  }, [base, loadVersion]);
  const target = releases.find((item) => item.id === selected);
  const immediate = !target && mode === 'now';
  const dueAt = target || immediate ? null : releaseInstant(timing);
  const moving = !!existing && existing.releaseId !== selected;
  const updating = !!existing && existing.releaseId === selected;
  const locked = !loaded || busy || !!payload.current;
  const canSubmit = loaded && !busy && (!!target || (!!name.trim() && (immediate || !!dueAt)));
  async function schedule() {
    setBusy(true);
    setError(null);
    try {
      payload.current ??= {
        requestId: crypto.randomUUID(),
        checkpointId: checkpoint.id,
        referenceChoices,
        expectedScheduleId: existing?.id ?? null,
        expectedRevision: existing?.revision ?? null,
        expectedReleaseRevision: existing?.releaseRevision,
        ...(target
          ? { release: { id: target.id, revision: target.revision } }
          : {
              releaseName: name,
              ...(immediate
                ? { now: true, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
                : { dueAt, timezone: timing.timezone, localTime: timing.localTime }),
            }),
      };
      await api(`${base}/schedules`, jsonRequest('POST', payload.current));
      onScheduled();
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
      className="schedule-form release-schedule-form"
      aria-label="Choose a release"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) void schedule();
      }}
    >
      <div className="release-approval">
        <span className="release-detail-mark">
          <Layers size={18} aria-hidden="true" />
        </span>
        <div>
          <strong>Approve revision {checkpoint.revision}</strong>
          <p>Later edits stay in drafts.</p>
        </div>
      </div>
      <div className="release-schedule-fields" data-new={!target || undefined}>
        <Field label="Release" htmlFor="release-choice">
          <select
            id="release-choice"
            ref={releaseSelect}
            value={selected}
            disabled={locked}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="new">Create a new release</option>
            {releases.map((release) => (
              <option key={release.id} value={release.id}>
                {release.name} ·{' '}
                {!release.dueAt
                  ? 'Draft'
                  : release.immediate && release.status === 'scheduled'
                    ? 'Now'
                    : dateLabel(release.dueAt, release.timezone)}
                {release.status === 'held' ? ' · Needs attention' : ''}
              </option>
            ))}
          </select>
        </Field>
        {!target && (
          <Field label="Release name" htmlFor="release-name">
            <input
              id="release-name"
              value={name}
              maxLength={120}
              disabled={locked}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Summer launch"
            />
          </Field>
        )}
      </div>
      {target ? (
        <div className="release-destination">
          {target.status === 'draft' ? <Layers size={18} /> : <CalendarClock size={18} />}
          <div>
            <strong>
              {!target.dueAt
                ? 'Draft release'
                : target.immediate && target.status === 'scheduled'
                  ? 'Publish as soon as approved'
                  : dateLabel(target.dueAt, target.timezone)}
            </strong>
            <p>
              {target.dueAt ? target.timezone : 'No publication time set'} · {target.items.length}{' '}
              approved {target.items.length === 1 ? 'page' : 'pages'}
            </p>
            {target.status === 'held' && (
              <p className="release-draft-note">
                This release is on hold. After updating its pages, open the release to review and
                resume it.
              </p>
            )}
          </div>
        </div>
      ) : (
        <fieldset className="release-publication" disabled={locked}>
          <legend>Publication</legend>
          <ReleasePublicationOptions value={mode} onChange={setMode} />
          {immediate ? (
            <p className="release-publication-hint">
              The approved page and any linked pages you selected will publish together on the next
              run.
            </p>
          ) : (
            <ReleaseTimeFields value={timing} onChange={setTiming} disabled={locked} />
          )}
        </fieldset>
      )}
      {moving && (
        <p className="notice notice--warning">
          This moves the page out of <strong>{existing.releaseName}</strong>. It will belong only to{' '}
          {target?.name ?? 'the new release'}.
        </p>
      )}
      {updating && (
        <p className="field-hint">This replaces the approved version in {target?.name}.</p>
      )}
      <ErrorNotice
        message={error}
        retry={
          payload.current
            ? undefined
            : () => {
                setError(null);
                setLoadVersion((value) => value + 1);
              }
        }
      />
      <div className="dialog-actions">
        <Button disabled={busy} onClick={onCancel}>
          Back
        </Button>
        <Button variant="primary" type="submit" disabled={!canSubmit}>
          {immediate ? (
            <Zap size={16} aria-hidden="true" />
          ) : (
            <CalendarClock size={16} aria-hidden="true" />
          )}
          {busy
            ? 'Saving…'
            : payload.current
              ? 'Retry'
              : immediate
                ? moving
                  ? 'Move & release now'
                  : 'Create & release now'
                : moving
                  ? 'Move to release'
                  : updating
                    ? 'Update release'
                    : target
                      ? 'Add to release'
                      : 'Create release & schedule'}
        </Button>
      </div>
    </form>
  );
}
