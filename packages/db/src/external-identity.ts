import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { parseInput, StorypaneError } from '@storypane/core';

const identityInput = z
  .object({
    provider: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,63}$/)
      .refine((v) => !['local', 'clerk'].includes(v)),
    subject: z.string().min(1).max(1024),
    email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
    emailVerified: z.literal(true),
    name: z.string().min(1).max(120),
  })
  .strict();

/** Only pass claims verified by the provider, never profile values from the browser. */
export async function resolveExternalIdentity(pool: Pool, raw: unknown) {
  const input = parseInput(identityInput, raw);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const providerId = `storypane:${input.provider}`;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,36))', [
      JSON.stringify([providerId, input.subject]),
    ]);
    const account = (
      await client.query('SELECT "userId" FROM account WHERE "providerId"=$1 AND "accountId"=$2', [
        providerId,
        input.subject,
      ])
    ).rows[0];
    const id: string = account?.userId ?? randomUUID();
    if (account) {
      const user = await client.query(
        'SELECT id FROM "user" WHERE id=$1 AND NOT disabled FOR UPDATE',
        [id],
      );
      if (!user.rowCount)
        throw new StorypaneError('unauthenticated', 'Account is disabled or unavailable');
      await client.query(
        'UPDATE "user" SET name=$2,email=$3,"emailVerified"=true,"updatedAt"=now() WHERE id=$1',
        [id, input.name, input.email],
      );
    } else {
      // A duplicate email must fail; only an operator may link an existing identity.
      await client.query(
        'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',
        [id, input.name, input.email],
      );
      await client.query(
        'INSERT INTO account(id,"providerId","accountId","userId") VALUES($1,$2,$3,$4)',
        [randomUUID(), providerId, input.subject, id],
      );
    }
    await client.query('COMMIT');
    return { id, name: input.name, email: input.email };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Operator-only explicit linking; never call this with an untrusted requested user ID. */
export async function linkExternalIdentity(
  pool: Pool,
  provider: string,
  subject: string,
  userId: string,
) {
  parseInput(identityInput.pick({ provider: true, subject: true }), { provider, subject });
  const result = await pool.query(
    `INSERT INTO account(id,"providerId","accountId","userId")
    SELECT $1,$2,$3,id FROM "user" WHERE id=$4 AND NOT disabled
    ON CONFLICT("providerId","accountId") DO UPDATE SET "updatedAt"=now()
    WHERE account."userId"=EXCLUDED."userId" RETURNING "userId"`,
    [randomUUID(), `storypane:${provider}`, subject, userId],
  );
  if (!result.rowCount)
    throw new StorypaneError(
      'invalid',
      'Identity not found or subject already linked to another account',
    );
}
