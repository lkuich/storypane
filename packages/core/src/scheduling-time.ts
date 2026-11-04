export type ScheduleInstant = { instant: string; offset: string };

/** Return every valid UTC instant for a wall-clock minute, including both sides of DST overlap. */
export function scheduleInstants(localTime: string, timezone: string): ScheduleInstant[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localTime)) return [];
  const wall = Date.parse(`${localTime}:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== localTime) return [];
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return [];
  }
  const formatted = (time: number) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(time).map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = wall + hours * 3_600_000;
    offsets.add(Date.parse(`${formatted(sample)}:00Z`) - sample);
  }
  return [...offsets]
    .filter((offset) => formatted(wall - offset) === localTime)
    .map((offset) => ({
      instant: new Date(wall - offset).toISOString(),
      offset: `UTC${offset >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offset) / 3_600_000)).padStart(2, '0')}:${String((Math.abs(offset) / 60_000) % 60).padStart(2, '0')}`,
    }))
    .sort((a, b) => a.instant.localeCompare(b.instant));
}
