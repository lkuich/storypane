'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CalendarClock, CircleAlert, Layers } from 'lucide-react';
import type {
  CheckpointDetail,
  ContentRelease,
  PublicationSchedule,
  PublicationReferenceChoice,
} from '@storypane/core';
import { Button, ErrorNotice, Field } from '@storypane/ui';
import { ApiError, api, dateLabel, errorMessage, jsonRequest } from './api';
import { spaceUrl } from '../../lib/space-url';
import { ReleaseTimeFields, releaseTime, releaseInstant } from '../releases/release-time';

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
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      stopped = true;
      clearInterval(timer);
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
          aria-label="Scheduled release"
        >
          <span className="release-banner-icon">
            {scheduled.releaseStatus === 'held' ? <CircleAlert /> : <CalendarClock />}
          </span>
          <div className="release-banner-copy">
            <span className="release-eyebrow">
              {scheduled.releaseStatus === 'held'
                ? 'Release needs attention'
                : 'In an upcoming release'}
            </span>
            <strong>{scheduled.releaseName}</strong>
            <p>
              {dateLabel(scheduled.dueAt, scheduled.timezone)} · {scheduled.timezone} ·{' '}
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
          (group) => group.canManage && ['scheduled', 'held'].includes(group.status),
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
  const dueAt = target?.dueAt ?? releaseInstant(timing);
  const moving = !!existing && existing.releaseId !== selected;
  const updating = !!existing && existing.releaseId === selected;
  async function schedule() {
    setBusy(true);
    setError(null);
    try {
      const time = target ? releaseTime(target.dueAt, target.timezone) : timing;
      payload.current ??= {
        requestId: crypto.randomUUID(),
        checkpointId: checkpoint.id,
        referenceChoices,
        dueAt,
        timezone: time.timezone,
        localTime: time.localTime,
        expectedScheduleId: existing?.id ?? null,
        expectedRevision: existing?.revision ?? null,
        expectedReleaseRevision: existing?.releaseRevision,
        ...(target
          ? { release: { id: target.id, revision: target.revision } }
          : { releaseName: name }),
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
    <section className="schedule-form release-schedule-form" aria-label="Choose a release">
      <div className="release-approval">
        <Layers size={19} />
        <div>
          <strong>Approve revision {checkpoint.revision}</strong>
          <p>
            Includes nested blocks and the linked pages you selected. Later edits stay in drafts.
          </p>
        </div>
      </div>
      <Field label="Release" htmlFor="release-choice">
        <select
          id="release-choice"
          ref={releaseSelect}
          value={selected}
          disabled={!loaded || busy || !!payload.current}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="new">Create a new release</option>
          {releases.map((release) => (
            <option key={release.id} value={release.id}>
              {release.name} · {dateLabel(release.dueAt, release.timezone)}
              {release.status === 'held' ? ' · Needs attention' : ''}
            </option>
          ))}
        </select>
      </Field>
      {target ? (
        <div className="release-destination">
          <CalendarClock size={18} />
          <div>
            <strong>{dateLabel(target.dueAt, target.timezone)}</strong>
            <p>
              {target.timezone} · {target.items.length} approved{' '}
              {target.items.length === 1 ? 'page' : 'pages'}
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
        <>
          <Field label="Release name" htmlFor="release-name">
            <input
              id="release-name"
              value={name}
              maxLength={120}
              disabled={busy || !!payload.current}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Summer launch"
            />
          </Field>
          <ReleaseTimeFields
            value={timing}
            onChange={setTiming}
            disabled={busy || !!payload.current}
          />
        </>
      )}
      {moving && (
        <p className="notice notice--warning">
          This moves the page out of <strong>{existing.releaseName}</strong>. It will belong only to{' '}
          {target?.name ?? 'the new release'}.
        </p>
      )}
      {updating && (
        <p className="field-hint">
          This replaces the approved version in {target?.name}. Its release time stays the same.
        </p>
      )}
      <ErrorNotice
        message={error}
        retry={() => {
          payload.current = null;
          setError(null);
          setLoadVersion((value) => value + 1);
        }}
      />
      <div className="dialog-actions">
        <Button disabled={busy} onClick={onCancel}>
          Back
        </Button>
        <Button
          variant="primary"
          disabled={busy || !loaded || !dueAt || (!target && !name.trim())}
          onClick={() => void schedule()}
        >
          <CalendarClock size={16} />
          {busy
            ? 'Saving…'
            : payload.current
              ? 'Retry'
              : moving
                ? 'Move to release'
                : updating
                  ? 'Update release'
                  : target
                    ? 'Add to release'
                    : 'Create release & schedule'}
        </Button>
      </div>
    </section>
  );
}
