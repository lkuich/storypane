import { expect, it } from 'vitest';
import { releaseTime, releaseInstant } from './release-time';
it('retains the approved instant when displaying a release across DST overlaps and fractional offsets', () => {
  for (const [instant, zone] of [
    ['2027-11-07T09:30:00.000Z', 'America/Los_Angeles'],
    ['2027-01-01T00:00:00.000Z', 'Asia/Kathmandu'],
  ])
    expect(releaseInstant(releaseTime(instant, zone))).toBe(instant);
  expect(
    releaseInstant({ localTime: '2027-03-14T02:30', timezone: 'America/Los_Angeles', instant: '' }),
  ).toBe('');
});
