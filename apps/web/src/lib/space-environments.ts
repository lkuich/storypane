import type { Space } from '@storypane/core';

export function groupSpacesForSwitcher(
  spaces: Space[],
  current: Pick<Space, 'id' | 'environment' | 'productionSpaceId'>,
) {
  const productionId = current.environment === 'dev' ? current.productionSpaceId : current.id;
  const linked: Space[] = [],
    other: Space[] = [];
  for (const space of spaces) {
    if (!space.role || (space.provisioningStatus && space.provisioningStatus !== 'ready')) continue;
    const related =
      space.id === current.id ||
      (!!productionId && (space.id === productionId || space.productionSpaceId === productionId));
    (related ? linked : other).push(space);
  }
  const sort = (a: Space, b: Space) =>
    Number(a.environment === 'dev') - Number(b.environment === 'dev') ||
    a.name.localeCompare(b.name);
  return { linked: linked.sort(sort), other: other.sort(sort) };
}
