import { z } from 'zod';
import type { PoolClient } from 'pg';
import { StorypaneError, parseInput, type AccountInvitation } from '@storypane/core';
import { createLocalAccount } from './local-auth.js';
import { hashToken, type Installation } from './installation.js';

export async function listAccountInvitations(
  installation: Installation,
  userId: string,
): Promise<AccountInvitation[]> {
  const account = (
    await installation.pool.query(
      'SELECT lower(email) AS email FROM "user" WHERE id=$1 AND "emailVerified" AND NOT disabled',
      [userId],
    )
  ).rows[0];
  if (!account) return [];

  const invites: AccountInvitation[] = [];
  await installation.forEachSpace(async (id) => {
    const selected = await installation.acquire(id);
    try {
      const { rows } = await selected.db.query(
        `SELECT i.id,i.space_id,s.name AS space_name,r.name AS role_name,i.expires_at
         FROM space_invitations i
         JOIN spaces s ON s.id=i.space_id
         JOIN space_roles r ON (r.space_id,r.id)=(i.space_id,i.role)
         WHERE i.space_id=$1 AND i.email=$2 AND i.expires_at>clock_timestamp()`,
        [id, account.email],
      );
      invites.push(
        ...rows.map((row) => ({
          id: row.id,
          spaceId: row.space_id,
          spaceName: row.space_name,
          roleName: row.role_name,
          expiresAt: row.expires_at.toISOString(),
        })),
      );
    } finally {
      await selected.close();
    }
  });
  return invites.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt) || a.id.localeCompare(b.id));
}

const invitationLink = z.strictObject({
  spaceId: z.uuid(),
  token: z.string().regex(/^si_[\w-]{43}$/),
  name: z.string().max(120).optional(),
  password: z.string().max(128).optional(),
});
const accountInvitation = z.strictObject({ spaceId: z.uuid(), invitationId: z.uuid() });

export async function acceptInvitation(installation: Installation, raw: unknown, userId?: string) {
  return redeemInvitation(installation, parseInput(invitationLink, raw), userId);
}

export async function acceptAccountInvitation(
  installation: Installation,
  raw: unknown,
  userId: string,
) {
  return redeemInvitation(installation, parseInput(accountInvitation, raw), userId);
}

async function redeemInvitation(
  installation: Installation,
  input: z.infer<typeof invitationLink> | z.infer<typeof accountInvitation>,
  userId?: string,
) {
  const fromLink = 'token' in input;
  const selected = await installation.acquire(input.spaceId);
  let space: PoolClient | undefined;
  let control: PoolClient | undefined;
  try {
    space = await selected.db.connect();
    control = await installation.pool.connect();
    await space.query('BEGIN');
    let user = userId
      ? (
          await control.query(
            'SELECT id,name,email,"emailVerified" FROM "user" WHERE id=$1 AND NOT disabled',
            [userId],
          )
        ).rows[0]
      : undefined;
    if (!fromLink && !user?.emailVerified)
      throw new StorypaneError('forbidden', 'Verify your invited email address first');
    const invitation = (
      fromLink
        ? await space.query(
            'SELECT id,email,role FROM space_invitations WHERE space_id=$1 AND token_hash=$2 AND expires_at>clock_timestamp() FOR UPDATE',
            [input.spaceId, hashToken(input.token)],
          )
        : await space.query(
            'SELECT id,email,role FROM space_invitations WHERE space_id=$1 AND id=$2 AND email=$3 AND expires_at>clock_timestamp() FOR UPDATE',
            [input.spaceId, input.invitationId, user.email.toLowerCase()],
          )
    ).rows[0];
    if (!invitation) throw new StorypaneError('invalid', 'Invitation expired or already used');
    if (userId) {
      if (!user || user.email.toLowerCase() !== invitation.email)
        throw new StorypaneError('forbidden', 'Sign in with the invited account');
    } else if (fromLink) {
      if (installation.options.provider !== 'local')
        throw new StorypaneError('unauthenticated', 'Sign in to accept this invitation');
      await control.query('BEGIN');
      if (
        (await control.query('SELECT id FROM "user" WHERE lower(email)=$1', [invitation.email]))
          .rowCount
      )
        throw new StorypaneError(
          'invalid',
          'Sign in to your existing account to accept this invitation',
        );
      user = await createLocalAccount(control, {
        email: invitation.email,
        name: input.name,
        password: input.password,
      });
      // If the space commit fails, the account can sign in and retry the same unconsumed invitation.
      await control.query('COMMIT');
    }
    await space.query(
      'INSERT INTO "user"(id,name,email) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=$2,email=$3',
      [user.id, user.name, user.email],
    );
    await space.query(
      'INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(space_id,user_id) DO NOTHING',
      [input.spaceId, user.id, invitation.role],
    );
    await space.query('DELETE FROM space_invitations WHERE id=$1', [invitation.id]);
    await space.query('COMMIT');
    return { ok: true, email: user.email };
  } catch (error) {
    await space?.query('ROLLBACK');
    await control?.query('ROLLBACK');
    throw error;
  } finally {
    space?.release();
    control?.release();
    await selected.close();
  }
}
