'use client';
import { useId } from 'react';
import { scheduleInstants } from '@storypane/core';
import { Field } from '@storypane/ui';

export type ReleaseTime = { localTime: string; timezone: string; instant: string };
export function releaseTime(
  dueAt?: string,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): ReleaseTime {
  if (!dueAt) return { localTime: '', timezone, instant: '' };
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(dueAt))
      .map((part) => [part.type, part.value]),
  );
  return {
    localTime: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`,
    timezone,
    instant: new Date(dueAt).toISOString(),
  };
}
export function releaseInstant(value: ReleaseTime) {
  const candidates = scheduleInstants(value.localTime, value.timezone);
  return candidates.length === 1
    ? candidates[0].instant
    : (candidates.find((item) => item.instant === value.instant)?.instant ?? '');
}
export function ReleaseTimeFields({
  value,
  onChange,
  disabled = false,
}: {
  value: ReleaseTime;
  onChange: (value: ReleaseTime) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const candidates = scheduleInstants(value.localTime, value.timezone);
  return (
    <div className="release-time-fields">
      <Field label="Release date and time" htmlFor={`${id}-time`}>
        <input
          id={`${id}-time`}
          type="datetime-local"
          value={value.localTime}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, localTime: event.target.value, instant: '' })}
        />
      </Field>
      <Field
        label="Timezone"
        htmlFor={`${id}-zone`}
        description="Everyone in this release shares this time."
      >
        <input
          id={`${id}-zone`}
          value={value.timezone}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, timezone: event.target.value, instant: '' })}
        />
      </Field>
      {candidates.length > 1 && (
        <Field label="This time occurs twice. Choose an offset." htmlFor={`${id}-offset`}>
          <select
            id={`${id}-offset`}
            value={value.instant}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, instant: event.target.value })}
          >
            <option value="">Choose an offset</option>
            {candidates.map((item) => (
              <option key={item.instant} value={item.instant}>
                {item.offset}
              </option>
            ))}
          </select>
        </Field>
      )}
      {!!value.localTime && !candidates.length && (
        <p className="field-error" role="alert">
          Choose a valid date and timezone. Times skipped by a clock change cannot be scheduled.
        </p>
      )}
    </div>
  );
}
