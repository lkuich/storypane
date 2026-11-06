import { expect, it } from 'vitest';
import type { Space } from '@storypane/core';
import { groupSpacesForSwitcher } from './space-environments';

const space = (id: string, environment: 'prod' | 'dev', productionSpaceId?: string): Space => ({
  id,
  environment,
  productionSpaceId,
  name: id,
  description: '',
  role: 'admin',
  roleName: 'Admin',
  permissions: [],
  createdAt: '',
  storyCount: 0,
  memberCount: 1,
});
it('groups one production space and all its developers in either direction', () => {
  const prod = space('Production', 'prod'),
    first = space('Alex', 'dev', prod.id),
    second = space('Maya', 'dev', prod.id),
    other = space('Other', 'prod');
  const spaces = [second, other, first, prod];
  for (const current of [prod, first, second]) {
    expect(groupSpacesForSwitcher(spaces, current)).toEqual({
      linked: [prod, first, second],
      other: [other],
    });
  }
});
it('does not treat unrelated standalone dev spaces as linked', () => {
  const first = space('First', 'dev'),
    second = space('Second', 'dev');
  expect(groupSpacesForSwitcher([first, second], first)).toEqual({
    linked: [first],
    other: [second],
  });
});
it('omits spaces without membership or a ready database from switching targets', () => {
  const prod = space('Production', 'prod'),
    unavailable = { ...space('Failed', 'dev', prod.id), provisioningStatus: 'failed' as const },
    inaccessible = { ...space('Private', 'dev', prod.id), role: '' };
  expect(groupSpacesForSwitcher([prod, unavailable, inaccessible], prod)).toEqual({
    linked: [prod],
    other: [],
  });
});
