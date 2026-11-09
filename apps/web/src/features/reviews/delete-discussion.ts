import type { Discussion } from '@storypane/core';
import { api } from '../editor/api';

export async function deleteDiscussion(discussion: Discussion) {
  const name = discussion.kind === 'review' ? 'review' : 'discussion';
  if (
    !window.confirm(
      `Delete this ${name} and all its messages and approvals? This cannot be undone. Deleting a review removes its publishing requirement.`,
    )
  )
    return false;
  await api(`/reviews/${discussion.id}`, { method: 'DELETE' });
  window.dispatchEvent(new Event('reviews-changed'));
  return true;
}
