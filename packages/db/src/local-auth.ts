import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { hashPassword } from 'better-auth/crypto';
import { createTransport } from 'nodemailer';
import type { Pool, PoolClient } from 'pg';
import { StorypaneError, parseInput } from '@storypane/core';
import { z } from 'zod';

export function localAuth(
  db: Pool,
  options: { appURL: string; secret: string; smtpURL?: string; mailFrom?: string },
) {
  if (!options.secret || options.secret.length < 32)
    throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');
  const mail = options.smtpURL ? createTransport(options.smtpURL) : undefined;
  const auth = betterAuth({
    database: db,
    baseURL: options.appURL,
    secret: options.secret,
    trustedOrigins: [options.appURL],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      ...(mail && options.mailFrom
        ? {
            sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
              await mail.sendMail({
                from: options.mailFrom,
                to: user.email,
                subject: 'Reset your Storypane password',
                text: `Reset your password: ${url}`,
              });
            },
          }
        : {}),
    },
    session: { cookieCache: { enabled: false } },
    advanced: { useSecureCookies: new URL(options.appURL).protocol === 'https:' },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 30 },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const user = await db.query('SELECT id FROM "user" WHERE id=$1 AND NOT disabled', [
              session.userId,
            ]);
            if (!user.rowCount) return false;
          },
        },
      },
    },
  });
  return {
    ...auth,
    handler: async (request: Parameters<typeof auth.handler>[0]) => {
      if (
        !['GET', 'HEAD'].includes(request.method) &&
        request.headers.get('origin') !== options.appURL
      )
        return Response.json(
          { message: 'This request must come from the editor.' },
          { status: 403 },
        );
      return auth.handler(request);
    },
  };
}

export const accountInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(128),
});
// Used by the operator CLI and invitation acceptance, never a public signup endpoint.
export async function createLocalAccount(client: PoolClient, raw: unknown, admin = false) {
  const input = parseInput(accountInput, raw);
  const id = randomUUID();
  const password = await hashPassword(input.password);
  await client.query('INSERT INTO "user"(id,name,email,installation_admin) VALUES($1,$2,$3,$4)', [
    id,
    input.name,
    input.email,
    admin,
  ]);
  await client.query(
    'INSERT INTO account(id,"accountId","providerId","userId",password) VALUES($1,$2,\'credential\',$2,$3)',
    [randomUUID(), id, password],
  );
  return { id, name: input.name, email: input.email };
}
export async function recoverLocalAccount(client: PoolClient, email: string, password: string) {
  parseInput(z.string().min(12).max(128), password);
  const user = (
    await client.query('SELECT id FROM "user" WHERE lower(email)=$1 FOR UPDATE', [
      email.trim().toLowerCase(),
    ])
  ).rows[0];
  if (!user) throw new StorypaneError('not_found', 'Local account not found');
  const result = await client.query(
    'UPDATE account SET password=$2,"updatedAt"=now() WHERE "userId"=$1 AND "providerId"=\'credential\'',
    [user.id, await hashPassword(password)],
  );
  if (!result.rowCount) throw new StorypaneError('invalid', 'Account has no local credential');
  await client.query('DELETE FROM "session" WHERE "userId"=$1', [user.id]);
  await client.query('DELETE FROM verification WHERE value=$1', [user.id]);
}

export async function emailInvitation(email: string, link: string) {
  if (!process.env.SMTP_URL || !process.env.MAIL_FROM) return false;
  try {
    await createTransport(process.env.SMTP_URL).sendMail({
      from: process.env.MAIL_FROM,
      to: email,
      subject: 'Your Storypane invitation',
      text: `Accept your invitation within seven days: ${link}`,
    });
    return true;
  } catch {
    return false;
  }
}

export async function migrateLocalCredential(client: PoolClient, userId: string, password: string) {
  parseInput(z.string().min(12).max(128), password);
  if (!(await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [userId])).rowCount)
    throw new StorypaneError('not_found', 'Account not found');
  await client.query('UPDATE "user" SET email=lower(trim(email)) WHERE id=$1', [userId]);
  await client.query(
    `INSERT INTO account(id,"accountId","providerId","userId",password) VALUES($1,$2,'credential',$2,$3)
    ON CONFLICT("providerId","accountId") DO UPDATE SET password=$3,"updatedAt"=now()`,
    [randomUUID(), userId, await hashPassword(password)],
  );
  await client.query('DELETE FROM "session" WHERE "userId"=$1', [userId]);
  await client.query('DELETE FROM cms_sessions WHERE user_id=$1', [userId]);
  await client.query('DELETE FROM verification WHERE value=$1', [userId]);
}
