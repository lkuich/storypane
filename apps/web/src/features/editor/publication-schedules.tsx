'use client';
import { useEffect, useRef, useState } from 'react';
import { scheduleInstants, type CheckpointDetail, type PublicationSchedule } from '@storypane/core';
import { Button, ErrorNotice, Field } from '@storypane/ui';
import { api, dateLabel, errorMessage, jsonRequest } from './api';

export function PublicationSchedules({
  base,
  revision,
  refresh,
  canPublish,
  onReview,
}: {
  base: string;
  revision: number;
  refresh: number;
  canPublish: boolean;
  onReview: (id: string) => void;
}) {
  const [schedules, setSchedules] = useState<PublicationSchedule[]>([]);
  const cancellationIds = useRef(new Map<string, string>());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stopped = false;
    const load = () =>
      api<PublicationSchedule[]>(`${base}/schedules`)
        .then((items) => {
          if (!stopped) setSchedules(items);
        })
        .catch((error) => {
          if (!stopped) setError(errorMessage(error));
        });
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [base, refresh, revision]);
  async function cancel(schedule: PublicationSchedule) {
    setBusy(true);
    setError(null);
    try {
      const key = `${schedule.id}:${schedule.revision}`;
      if (!cancellationIds.current.has(key)) cancellationIds.current.set(key, crypto.randomUUID());
      await api(
        `${base}/schedules/${schedule.id}`,
        jsonRequest('DELETE', {
          requestId: cancellationIds.current.get(key),
          revision: schedule.revision,
        }),
      );
      setSchedules(await api(`${base}/schedules`));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  const visible = schedules
    .filter((item) => item.status === 'pending' || item.status === 'failed')
    .slice(0, 3);
  return (
    <>
      <ErrorNotice message={error} />
      {visible.map((schedule) => (
        <div className="publication-note" key={schedule.id}>
          <span>
            <strong>
              {schedule.status === 'pending' ? 'Scheduled' : 'Schedule failed'} · revision{' '}
              {schedule.checkpointRevision}
            </strong>{' '}
            · {dateLabel(schedule.dueAt)} ({schedule.timezone})
            {revision > schedule.checkpointRevision ? ' · Newer draft edits are not included.' : ''}
            {schedule.error && ` · ${schedule.error}`}
          </span>
          {canPublish && (
            <div className="dialog-actions">
              <Button disabled={busy} onClick={() => onReview(schedule.checkpointId)}>
                Review / reschedule / publish now
              </Button>
              {schedule.status === 'pending' && (
                <Button disabled={busy} onClick={() => void cancel(schedule)}>
                  Cancel schedule
                </Button>
              )}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

export function ScheduleForm({
  base,
  checkpoint,
  onScheduled,
}: {
  base: string;
  checkpoint: CheckpointDetail;
  onScheduled: () => void;
}) {
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [localTime, setLocalTime] = useState('');
  const [instant, setInstant] = useState('');
  const [existing, setExisting] = useState<PublicationSchedule | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payload = useRef<unknown>(null);
  useEffect(() => {
    let stopped = false;
    api<PublicationSchedule[]>(`${base}/schedules`)
      .then((items) => {
        if (!stopped) {
          setExisting(items.find((item) => item.status === 'pending') ?? null);
          setLoaded(true);
        }
      })
      .catch((error) => {
        if (!stopped) setError(errorMessage(error));
      });
    return () => {
      stopped = true;
    };
  }, [base]);
  let candidates: ReturnType<typeof scheduleInstants> = [];
  let timeError: string | null = null;
  if (localTime)
    try {
      candidates = scheduleInstants(localTime, timezone);
      if (!candidates.length)
        timeError =
          'This local time does not exist because the clocks change. Choose another time.';
    } catch {
      timeError = 'Enter a valid date and IANA timezone, such as America/Vancouver.';
    }
  const chosen = candidates.length === 1 ? candidates[0].instant : instant;
  async function schedule() {
    setBusy(true);
    setError(null);
    try {
      payload.current ??= {
        requestId: crypto.randomUUID(),
        checkpointId: checkpoint.id,
        dueAt: chosen,
        timezone,
        localTime,
        expectedScheduleId: existing?.id ?? null,
        expectedRevision: existing?.revision ?? null,
      };
      await api(`${base}/schedules`, jsonRequest('POST', payload.current));
      onScheduled();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>Schedule revision {checkpoint.revision}</h3>
      <p>
        Only this saved revision will publish. Later edits remain drafts.
        {existing ? ' This replaces the pending schedule.' : ''}
      </p>
      <Field label="Local date and time" htmlFor="schedule-time">
        <input
          type="datetime-local"
          id="schedule-time"
          value={localTime}
          disabled={busy || !!payload.current}
          onChange={(event) => {
            setLocalTime(event.target.value);
            setInstant('');
          }}
        />
      </Field>
      <Field label="Timezone" htmlFor="schedule-zone">
        <input
          id="schedule-zone"
          value={timezone}
          disabled={busy || !!payload.current}
          onChange={(event) => {
            setTimezone(event.target.value);
            setInstant('');
          }}
        />
      </Field>
      {candidates.length > 1 && (
        <Field label="This time occurs twice. Choose its UTC offset." htmlFor="schedule-offset">
          <select
            id="schedule-offset"
            value={instant}
            disabled={busy || !!payload.current}
            onChange={(event) => setInstant(event.target.value)}
          >
            <option value="">Choose an offset</option>
            {candidates.map((candidate) => (
              <option key={candidate.instant} value={candidate.instant}>
                {candidate.offset} · {candidate.instant}
              </option>
            ))}
          </select>
        </Field>
      )}
      {chosen && (
        <p>
          Publish at {chosen} ({timezone}).
        </p>
      )}
      <ErrorNotice message={timeError ?? error} />
      <Button disabled={busy || !loaded || !chosen || !!timeError} onClick={() => void schedule()}>
        {busy
          ? 'Scheduling…'
          : payload.current
            ? 'Retry schedule'
            : existing
              ? 'Replace schedule'
              : 'Schedule publication'}
      </Button>
    </section>
  );
}
