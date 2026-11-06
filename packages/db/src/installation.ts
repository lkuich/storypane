import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { z } from 'zod';
import {
  StorypaneError,
  parseInput,
  spaceInputSchema,
  type Actor,
  type SpaceConnection,
} from '@storypane/core';
import { createClerkClient } from '@clerk/backend';
import { createClerkChecks, type ClerkChecks } from './clerk-checks.js';
import { StorypaneStore } from './store.js';
import { migrate } from './migrate.js';

export type Provider = 'local' | 'clerk';
export function authProvider(value = process.env.AUTH_PROVIDER ?? 'local'): Provider {
  if (value !== 'local' && value !== 'clerk')
    throw new Error('AUTH_PROVIDER must be local or clerk');
  return value;
}
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
export function connectionURL(value: string) {
  parseInput(z.string().max(4096), value);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StorypaneError('invalid', 'Provide a valid PostgreSQL connection URL');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.username ||
    !url.password ||
    url.pathname.length < 2
  )
    throw new StorypaneError(
      'invalid',
      'Provide a PostgreSQL URL with a database and dedicated credentials',
    );
  if ([...url.searchParams.keys()].some((key) => key !== 'sslmode'))
    throw new StorypaneError('invalid', 'Only sslmode is allowed in connection URL parameters');
  return url;
}
export async function assertDedicatedRole(db: Pool) {
  const role = (
    await db.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
    EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid) AS member
    FROM pg_roles WHERE rolname=current_user`)
  ).rows[0];
  if (Object.values(role).some(Boolean))
    throw new StorypaneError(
      'invalid',
      'Use a dedicated unprivileged database role without role memberships',
    );
  if (
    (
      await db.query(
        "SELECT 1 FROM pg_database WHERE datname<>current_database() AND datallowconn AND has_database_privilege(current_user,oid,'CONNECT') LIMIT 1",
      )
    ).rowCount
  )
    throw new StorypaneError(
      'invalid',
      'Space role can connect to other databases. Revoke public CONNECT on the Postgres instance before attaching.',
    );
}
function encryptionKey(key: string) {
  const bytes = Buffer.from(key, 'base64');
  if (bytes.length !== 32) throw new Error('INSTALLATION_ENCRYPTION_KEY must encode 32 bytes');
  return bytes;
}
export function sealConnection(value: string, key: string, spaceId: string) {
  const bytes = encryptionKey(key);
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', bytes, iv);
  cipher.setAAD(Buffer.from(spaceId));
  return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]).toString(
    'base64',
  );
}
export function openConnection(value: string, key: string, spaceId: string) {
  const data = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), data.subarray(0, 12));
  cipher.setAAD(Buffer.from(spaceId));
  cipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString();
}
export async function migrateInstallation(pool: Pool, provider: Provider) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(723198452)');
    if ((await client.query("SELECT to_regclass('spaces') AS table_name")).rows[0].table_name)
      throw new Error(
        'Use an empty installation database. Run the legacy split during maintenance.',
      );
    await client.query(
      'CREATE TABLE IF NOT EXISTS installation_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    if (
      !(await client.query("SELECT 1 FROM installation_migrations WHERE name='001_installation'"))
        .rowCount
    ) {
      await client.query(
        await readFile(
          new URL('../installation-migrations/001_installation.sql', import.meta.url),
          'utf8',
        ),
      );
      await client.query("INSERT INTO installation_migrations(name) VALUES('001_installation')");
      await client.query('INSERT INTO installation_config(auth_provider) VALUES($1)', [provider]);
    }
    const config = (await client.query('SELECT auth_provider FROM installation_config')).rows[0];
    if (config.auth_provider !== provider)
      throw new Error(
        'Authentication provider differs from the installation. An operator account migration is required.',
      );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export class Installation {
  readonly pool: Pool;
  private active = 0;
  private clerk?: ReturnType<typeof createClerkClient>;
  constructor(
    readonly options: {
      connectionString: string;
      encryptionKey: string;
      provider: Provider;
      provisioningURL?: string;
      clerkSecretKey?: string;
      clerkPublishableKey?: string;
      webhookEncryptionKey?: string;
      webhookHosts?: string[];
      externalOptionHosts?: string[];
    },
  ) {
    encryptionKey(options.encryptionKey);
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
    });
    this.pool.on('error', () => console.error('Installation database connection failed'));
  }
  async assertProvider() {
    const config = (await this.pool.query('SELECT auth_provider FROM installation_config')).rows[0];
    if (config?.auth_provider !== this.options.provider)
      throw new StorypaneError('unavailable', 'Authentication provider migration is required');
  }
  get auth() {
    if (this.options.provider !== 'clerk') throw new Error('Clerk is disabled');
    return (this.clerk ??= createClerkClient({
      secretKey: this.options.clerkSecretKey,
      publishableKey: this.options.clerkPublishableKey,
    }));
  }
  async assertIdentity(userId: string, checks?: ClerkChecks) {
    await this.assertProvider();
    const user = (
      await this.pool.query('SELECT clerk_user_id FROM "user" WHERE id=$1 AND NOT disabled', [
        userId,
      ])
    ).rows[0];
    if (!user) throw new StorypaneError('unauthenticated', 'Account is disabled or unavailable');
    if (this.options.provider === 'clerk') {
      if (!user.clerk_user_id)
        throw new StorypaneError('unauthenticated', 'Account has no Clerk mapping');
      checks ??= createClerkChecks(this.auth);
      const identity = await checks.getUser(user.clerk_user_id);
      if (identity.banned || identity.locked)
        throw new StorypaneError('unauthenticated', 'Account is disabled');
    }
  }
  async assertSession(actor: Pick<Actor, 'userId' | 'sessionId'>, checks?: ClerkChecks) {
    await this.assertProvider();
    const local = this.options.provider === 'local';
    const result = await this.pool.query(
      local
        ? 'SELECT u.id FROM "session" s JOIN "user" u ON u.id=s."userId" WHERE s.id=$1 AND u.id=$2 AND NOT u.disabled AND s."expiresAt">clock_timestamp()'
        : 'SELECT u.clerk_user_id FROM cms_sessions s JOIN "user" u ON u.id=s.user_id WHERE s.id=$1 AND u.id=$2 AND NOT u.disabled AND s.expires_at>clock_timestamp()',
      [actor.sessionId, actor.userId],
    );
    if (!result.rowCount) throw new StorypaneError('unauthenticated', 'Your session has expired');
    if (!local) {
      checks ??= createClerkChecks(this.auth);
      const session = await checks.getSession(actor.sessionId);
      const user = await checks.getUser(result.rows[0].clerk_user_id);
      if (session.status !== 'active' || session.userId !== user.id || user.banned || user.locked)
        throw new StorypaneError('unauthenticated', 'Your session has expired');
    }
  }
  async authAttempt(subject: string) {
    const key = `storypane:${hashToken(subject)}`;
    const now = Date.now();
    const result = await this.pool.query(
      `INSERT INTO "rateLimit"(id,key,count,"lastRequest") VALUES($1,$1,1,$2)
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN "rateLimit"."lastRequest"<$2-60000 THEN 1 ELSE "rateLimit".count+1 END,
      "lastRequest"=CASE WHEN "rateLimit"."lastRequest"<$2-60000 THEN $2 ELSE "rateLimit"."lastRequest" END RETURNING count`,
      [key, now],
    );
    if (result.rows[0].count > 10)
      throw new StorypaneError(
        'unavailable',
        'Too many authentication attempts. Retry in a minute.',
      );
  }
  async isAdmin(userId: string) {
    return Boolean(
      (
        await this.pool.query(
          'SELECT id FROM "user" WHERE id=$1 AND installation_admin AND NOT disabled',
          [userId],
        )
      ).rowCount,
    );
  }
  async directory() {
    return (
      await this.pool.query(
        'SELECT id,name,description,status,mode,created_at FROM space_connections ORDER BY created_at,id',
      )
    ).rows as Array<{
      id: string;
      name: string;
      description: string;
      status: 'ready' | 'failed' | 'provisioning';
      mode: 'create' | 'attach' | 'import';
      created_at: Date;
    }>;
  }
  async forEachSpace(run: (spaceId: string) => Promise<void>) {
    const entries = (await this.directory()).filter((space) => space.status === 'ready');
    const failures: string[] = [];
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, entries.length) }, async () => {
        while (index < entries.length) {
          const entry = entries[index++];
          try {
            await run(entry.id);
          } catch {
            failures.push(entry.id);
          }
        }
      }),
    );
    return failures;
  }
  async resolvePreview(token: string) {
    if (!/^bp_[\w-]{43}$/.test(token))
      throw new StorypaneError('unauthenticated', 'Invalid preview token');
    const row = (
      await this.pool.query(
        'SELECT space_id FROM preview_routes WHERE token_hash=$1 AND expires_at>clock_timestamp()',
        [hashToken(token)],
      )
    ).rows[0];
    if (!row) throw new StorypaneError('unauthenticated', 'Preview expired');
    return row.space_id as string;
  }
  async acquire(spaceId: string, checks?: ClerkChecks) {
    parseInput(z.uuid(), spaceId);
    if (this.active >= 16)
      throw new StorypaneError('unavailable', 'Database capacity is busy. Please retry.');
    this.active++;
    let db: Pool | undefined;
    try {
      const row = (
        await this.pool.query(
          "SELECT connection_secret FROM space_connections WHERE id=$1 AND status='ready'",
          [spaceId],
        )
      ).rows[0];
      if (!row) throw new StorypaneError('unavailable', 'Space database is not ready');
      db = new Pool({
        connectionString: openConnection(
          row.connection_secret,
          this.options.encryptionKey,
          spaceId,
        ),
        max: 2,
        connectionTimeoutMillis: 5000,
        statement_timeout: 30000,
      });
      db.on('error', () => console.error('Space database connection failed'));
      const binding = (await db.query('SELECT space_id FROM space_database')).rows;
      const spaces = (await db.query('SELECT id FROM spaces')).rows;
      if (
        binding.length !== 1 ||
        binding[0].space_id !== spaceId ||
        spaces.length !== 1 ||
        spaces[0].id !== spaceId
      )
        throw new StorypaneError('unavailable', 'Space database binding mismatch');
      const pool = db;
      const store = new StorypaneStore(pool, {
        webhookEncryptionKey: this.options.webhookEncryptionKey,
        webhookHosts: this.options.webhookHosts,
        externalOptionHosts: this.options.externalOptionHosts,
        spaceId,
        authorizeSession: (actor) => this.assertSession(actor, checks),
        authorizeIdentity: (userId) => this.assertIdentity(userId, checks),
        registerPreview: async (tokenHash, expiresAt) => {
          await this.pool.query('DELETE FROM preview_routes WHERE expires_at<now()');
          await this.pool.query(
            'INSERT INTO preview_routes(token_hash,space_id,expires_at) VALUES($1,$2,$3)',
            [tokenHash, spaceId, expiresAt],
          );
        },
      });
      let closed = false;
      return {
        db: pool,
        store,
        close: async () => {
          if (!closed) {
            closed = true;
            try {
              await pool.end();
            } finally {
              this.active--;
            }
          }
        },
      };
    } catch (error) {
      try {
        await db?.end();
      } finally {
        this.active--;
      }
      throw error;
    }
  }
  async syncProfile(db: Pool, userId: string) {
    const user = (
      await this.pool.query(
        'SELECT id,name,email,avatar_url FROM "user" WHERE id=$1 AND NOT disabled',
        [userId],
      )
    ).rows[0];
    if (!user) throw new StorypaneError('unauthenticated', 'Account unavailable');
    await db.query(
      'INSERT INTO "user"(id,name,email,avatar_url) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=$2,email=$3,avatar_url=$4',
      [user.id, user.name, user.email, user.avatar_url],
    );
  }
  async connectionDetails(
    ownerId: string,
    spaceId: string,
    reveal = false,
  ): Promise<SpaceConnection> {
    if (!(await this.isAdmin(ownerId)))
      throw new StorypaneError('forbidden', 'Installation administrator access is required');
    parseInput(z.uuid(), spaceId);
    const row = (
      await this.pool.query('SELECT status,connection_secret FROM space_connections WHERE id=$1', [
        spaceId,
      ])
    ).rows[0];
    if (!row) throw new StorypaneError('not_found', 'Space not found');
    if (!row.connection_secret) return { status: row.status, url: null };
    const value = openConnection(row.connection_secret, this.options.encryptionKey, spaceId);
    if (reveal) return { status: row.status, url: value };
    const masked = new URL(value);
    masked.password = '********';
    return { status: row.status, url: masked.href };
  }

  async updateConnection(ownerId: string, spaceId: string, connectionString: string) {
    if (!(await this.isAdmin(ownerId)))
      throw new StorypaneError('forbidden', 'Installation administrator access is required');
    parseInput(z.uuid(), spaceId);
    const url = connectionURL(connectionString);
    const candidate = new Pool({
      connectionString: url.href,
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    try {
      const bindings = (await candidate.query('SELECT space_id FROM space_database')).rows;
      const spaces = (await candidate.query('SELECT id FROM spaces')).rows;
      if (
        bindings.length !== 1 ||
        bindings[0].space_id !== spaceId ||
        spaces.length !== 1 ||
        spaces[0].id !== spaceId
      )
        throw new StorypaneError('invalid', 'Connection belongs to another space');
      await assertDedicatedRole(candidate);
      const result = await this.pool.query(
        "UPDATE space_connections SET connection_secret=$2,connection_fingerprint=$3 WHERE id=$1 AND status='ready'",
        [
          spaceId,
          sealConnection(url.href, this.options.encryptionKey, spaceId),
          hashToken(`${url.hostname}:${url.port || '5432'}${url.pathname}`),
        ],
      );
      if (!result.rowCount)
        throw new StorypaneError('invalid', 'Only ready spaces can change connections');
    } finally {
      await candidate.end();
    }
  }
  async provision(ownerId: string, raw: unknown) {
    if (!(await this.isAdmin(ownerId)))
      throw new StorypaneError('forbidden', 'Installation administrator access is required');
    const input = parseInput(
      spaceInputSchema.extend({
        id: z.uuid().optional(),
        mode: z.enum(['create', 'attach']),
        connectionString: z.string().optional(),
      }),
      raw,
    );
    const id = input.id ?? randomUUID();
    const lock = await this.pool.connect();
    let db: Pool | undefined;
    let provisioner: Pool | undefined;
    try {
      await lock.query('SELECT pg_advisory_lock(hashtextextended($1,31))', [id]);
      let row = (await lock.query('SELECT * FROM space_connections WHERE id=$1', [id])).rows[0];
      if (row?.status === 'ready') return { id, status: 'ready' as const };
      if (row && (row.owner_id !== ownerId || row.mode !== input.mode))
        throw new StorypaneError('invalid', 'Provisioning retry does not match');
      if (!row) {
        let url: URL;
        if (input.mode === 'create') {
          if (!this.options.provisioningURL)
            throw new StorypaneError(
              'invalid',
              'Automatic database provisioning is not configured',
            );
          url = connectionURL(this.options.provisioningURL);
          url.pathname = `/sp_${id.replaceAll('-', '')}`;
          url.username = `sp_${id.replaceAll('-', '')}`;
          url.password = randomBytes(32).toString('base64url');
        } else url = connectionURL(input.connectionString ?? '');
        const control = new URL(this.options.connectionString);
        if (
          url.hostname === control.hostname &&
          url.port === control.port &&
          url.pathname === control.pathname
        )
          throw new StorypaneError(
            'invalid',
            'The installation database cannot be attached as a space',
          );
        const fingerprint = hashToken(`${url.hostname}:${url.port || '5432'}${url.pathname}`);
        await lock.query(
          "INSERT INTO space_connections(id,name,description,status,connection_secret,connection_fingerprint,mode,owner_id) VALUES($1,$2,$3,'provisioning',$4,$5,$6,$7)",
          [
            id,
            input.name,
            input.description,
            sealConnection(url.href, this.options.encryptionKey, id),
            fingerprint,
            input.mode,
            ownerId,
          ],
        );
        row = (await lock.query('SELECT * FROM space_connections WHERE id=$1', [id])).rows[0];
      }
      await lock.query("UPDATE space_connections SET status='provisioning' WHERE id=$1", [id]);
      const url = connectionURL(
        openConnection(row.connection_secret, this.options.encryptionKey, id),
      );
      if (row.mode === 'create') {
        if (!this.options.provisioningURL)
          throw new StorypaneError('invalid', 'Automatic database provisioning is not configured');
        provisioner = new Pool({
          connectionString: this.options.provisioningURL,
          max: 1,
          connectionTimeoutMillis: 5000,
        });
        const role = decodeURIComponent(url.username),
          name = decodeURIComponent(url.pathname.slice(1));
        if (!(await provisioner.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
          await provisioner.query(
            `CREATE ROLE ${quote(role)} LOGIN PASSWORD ${literal(decodeURIComponent(url.password))} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
          );
        if (
          !(await provisioner.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount
        )
          await provisioner.query(
            `CREATE DATABASE ${quote(name)} OWNER ${quote(role)} TEMPLATE template0`,
          );
        const owner = (
          await provisioner.query(
            'SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1',
            [name],
          )
        ).rows[0];
        if (owner.owner !== role) throw new Error('Provisioned database owner mismatch');
        await provisioner.query(`REVOKE ALL ON DATABASE ${quote(name)} FROM PUBLIC`);
        await provisioner.query(`GRANT CONNECT ON DATABASE ${quote(name)} TO ${quote(role)}`);
      }
      db = new Pool({ connectionString: url.href, max: 1, connectionTimeoutMillis: 5000 });
      const binding = (await db.query("SELECT to_regclass('space_database') AS table_name"))
        .rows[0];
      if (!binding.table_name) {
        const objects = await db.query(
          "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1",
        );
        if (objects.rowCount)
          throw new StorypaneError('invalid', 'Attach requires an empty database');
        await assertDedicatedRole(db);
        await migrate(db, async (client) => {
          await client.query(
            'CREATE TABLE space_database(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),space_id uuid NOT NULL UNIQUE)',
          );
          await client.query('INSERT INTO space_database(space_id) VALUES($1)', [id]);
          await client.query('INSERT INTO spaces(id,name,description) VALUES($1,$2,$3)', [
            id,
            row.name,
            row.description,
          ]);
          await client.query(
            "INSERT INTO space_locales(space_id,name,slug,is_default) VALUES($1,'Default','',true)",
            [id],
          );
          const user = (
            await this.pool.query('SELECT id,name,email FROM "user" WHERE id=$1', [ownerId])
          ).rows[0];
          await client.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [
            user.id,
            user.name,
            user.email,
          ]);
          await client.query(
            "INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,'admin')",
            [id, ownerId],
          );
          await client.query(
            "INSERT INTO schema_migrations(space_id,version,base_version,name,status,definitions,deployed_at) VALUES($1,0,0,'Initial baseline','deployed','[]',now())",
            [id],
          );
        });
      } else if ((await db.query('SELECT space_id FROM space_database')).rows[0]?.space_id !== id)
        throw new StorypaneError('invalid', 'Database belongs to another space');
      await migrateSpace(db);
      await lock.query("UPDATE space_connections SET status='ready' WHERE id=$1", [id]);
      return { id, status: 'ready' as const };
    } catch (error) {
      await lock.query(
        "UPDATE space_connections SET status='failed' WHERE id=$1 AND status<>'ready'",
        [id],
      );
      throw error;
    } finally {
      await db?.end();
      await provisioner?.end();
      await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,31))', [id]);
      lock.release();
    }
  }
}
export async function migrateSpace(db: Pool) {
  if (!(await db.query("SELECT to_regclass('space_database') AS binding")).rows[0].binding)
    throw new Error(
      'Space migrations require a bound space database; the legacy source is not a destination',
    );
  const bound = (await db.query('SELECT space_id FROM space_database')).rows;
  const spaces = (await db.query('SELECT id FROM spaces')).rows;
  if (bound.length !== 1 || spaces.length !== 1 || bound[0].space_id !== spaces[0].id)
    throw new Error('Space database binding mismatch');
  await migrate(db);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(723198451)');
    if (
      !(await client.query("SELECT 1 FROM storypane_migrations WHERE name='025_space_database'"))
        .rowCount
    ) {
      await client.query('ALTER TABLE space_invitations ADD COLUMN token_hash text UNIQUE');
      await client.query('DROP TABLE IF EXISTS cms_sessions');
      await client.query('DROP TABLE IF EXISTS "session",account,verification');
      await client.query("INSERT INTO storypane_migrations(name) VALUES('025_space_database')");
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

let current: Installation | undefined;
export function getInstallation() {
  if (!current) {
    for (const name of ['INSTALLATION_DATABASE_URL', 'INSTALLATION_ENCRYPTION_KEY'])
      if (!process.env[name])
        throw new Error(
          `Missing ${name}; this release requires the Node installation database layout`,
        );
    current = new Installation({
      connectionString: process.env.INSTALLATION_DATABASE_URL!,
      encryptionKey: process.env.INSTALLATION_ENCRYPTION_KEY!,
      provider: authProvider(),
      provisioningURL: process.env.PROVISIONING_DATABASE_URL,
      clerkSecretKey: process.env.CLERK_SECRET_KEY,
      clerkPublishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY,
      webhookEncryptionKey: process.env.WEBHOOK_ENCRYPTION_KEY,
      webhookHosts: (process.env.WEBHOOK_HOSTS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      externalOptionHosts: (process.env.EXTERNAL_OPTION_HOSTS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }
  return current;
}
