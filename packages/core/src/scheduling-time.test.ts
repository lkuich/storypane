import { describe, expect, it } from 'vitest';
import { scheduleInstants } from './scheduling-time.js';
describe('timezone scheduling', () => {
  it('returns both explicit offsets during an autumn overlap', () =>
    expect(scheduleInstants('2027-11-07T01:30', 'America/Los_Angeles')).toEqual([
      { instant: '2027-11-07T08:30:00.000Z', offset: 'UTC-07:00' },
      { instant: '2027-11-07T09:30:00.000Z', offset: 'UTC-08:00' },
    ]));
  it('rejects missing spring minutes, invalid dates, and unknown zones', () => {
    expect(scheduleInstants('2027-03-14T02:30', 'America/Los_Angeles')).toEqual([]);
    expect(scheduleInstants('2027-02-30T02:30', 'UTC')).toEqual([]);
    expect(scheduleInstants('2027-03-14T02:30', 'Wrong/Zone')).toEqual([]);
  });
  it('resolves fractional offsets and midnight', () => {
    expect(scheduleInstants('2027-01-01T00:00', 'Asia/Kathmandu')).toEqual([
      { instant: '2026-12-31T18:15:00.000Z', offset: 'UTC+05:45' },
    ]);
    expect(scheduleInstants('2027-01-01T00:00', 'UTC')[0].instant).toBe('2027-01-01T00:00:00.000Z');
  });
});
