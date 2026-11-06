import type { createClerkClient } from '@clerk/backend';

type Clerk = ReturnType<typeof createClerkClient>;
export type ClerkChecks = Pick<Clerk['users'], 'getUser'> & Pick<Clerk['sessions'], 'getSession'>;
const pending = new WeakMap<Clerk, ClerkChecks>();

function memo<T>(load: (id: string) => Promise<T>, pendingOnly = false) {
  const entries = new Map<string, Promise<T>>();
  return (id: string) => {
    let result = entries.get(id);
    if (!result) {
      result = load(id);
      if (pendingOnly) result = result.finally(() => entries.delete(id));
      entries.set(id, result);
    }
    return result;
  };
}

/** Create a fresh scope for every HTTP request or room operation; never reuse completed scopes. */
export function createClerkChecks(clerk: Clerk): ClerkChecks {
  let shared = pending.get(clerk);
  if (!shared) {
    // Only in-flight calls cross request boundaries, including failures.
    shared = {
      getUser: memo((id) => clerk.users.getUser(id), true),
      getSession: memo((id) => clerk.sessions.getSession(id), true),
    };
    pending.set(clerk, shared);
  }
  return {
    getUser: memo(shared.getUser),
    getSession: memo(shared.getSession),
  };
}
