import { z } from 'zod';
import { StorypaneError, parseInput } from '@storypane/core';
import { createLocalAccount } from './local-auth.js';
import { hashToken, type Installation } from './installation.js';

export async function acceptInvitation(installation: Installation, raw: unknown, userId?: string) {
  const input = parseInput(
    z
      .object({
        spaceId: z.uuid(),
        token: z.string().regex(/^si_[\w-]{43}$/),
        name: z.string().max(120).optional(),
        password: z.string().max(128).optional(),
      })
      .strict(),
    raw,
  );
  const selected = await installation.acquire(input.spaceId);
  const space = await selected.db.connect();
  const control = await installation.pool.connect();
  try {
    await space.query('BEGIN');
    const invitation = (
      await space.query(
        'SELECT * FROM space_invitations WHERE space_id=$1 AND token_hash=$2 AND expires_at>clock_timestamp() FOR UPDATE',
        [input.spaceId, hashToken(input.token)],
      )
    ).rows[0];
    if (!invitation) throw new StorypaneError('invalid', 'Invitation expired or already used');
    let user;
    if (userId) {
      user = (
        await control.query('SELECT id,name,email FROM "user" WHERE id=$1 AND NOT disabled', [
          userId,
        ])
      ).rows[0];
      if (!user || user.email.toLowerCase() !== invitation.email)
        throw new StorypaneError('forbidden', 'Sign in with the invited account');
    } else {
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
    await space.query('ROLLBACK');
    await control.query('ROLLBACK');
    throw error;
  } finally {
    space.release();
    control.release();
    await selected.close();
  }
}
