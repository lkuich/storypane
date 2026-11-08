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
import { createAuthentication } from './auth-providers.js';
import type { Authentication, AuthenticationFactory } from './authentication.js';
import { StorypaneStore } from './store.js';
import { migrate } from './migrate.js';
import { captureSchema } from './schema-environments.js';
import {
  collectSchemaDependencies,
  schemaDigest,
  schemaIdentity,
  dependencySummary,
  installSchemaConfiguration,
  installSchemaContent,
  copySchemaAssets,
  type CopySchemaAsset,
} from './schema-dependencies.js';
import type { SchemaTransferReview } from '@storypane/core';

export type Provider = string;
export function authProvider(value = process.env.AUTH_PROVIDER ?? 'local'): Provider {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(value))
    throw new Error('AUTH_PROVIDER must be a lowercase provider name (up to 64 characters)');
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
  authProvider(provider);
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
    const freshInstallation = !(
      await client.query("SELECT 1 FROM installation_migrations WHERE name='001_installation'")
    ).rowCount;
    if (freshInstallation) {
      await client.query(
        await readFile(
          new URL('../installation-migrations/001_installation.sql', import.meta.url),
          'utf8',
        ),
      );
      await client.query("INSERT INTO installation_migrations(name) VALUES('001_installation')");
    }
    if (
      !(
        await client.query(
          "SELECT 1 FROM installation_migrations WHERE name='002_space_environments'",
        )
      ).rowCount
    ) {
      await client.query(
        await readFile(
          new URL('../installation-migrations/002_space_environments.sql', import.meta.url),
          'utf8',
        ),
      );
      await client.query(
        "INSERT INTO installation_migrations(name) VALUES('002_space_environments')",
      );
    }
    if (
      !(
        await client.query(
          "SELECT 1 FROM installation_migrations WHERE name='003_authentication_providers'",
        )
      ).rowCount
    ) {
      await client.query(
        await readFile(
          new URL('../installation-migrations/003_authentication_providers.sql', import.meta.url),
          'utf8',
        ),
      );
      await client.query(
        "INSERT INTO installation_migrations(name) VALUES('003_authentication_providers')",
      );
    }
    if (freshInstallation)
      await client.query('INSERT INTO installation_config(auth_provider) VALUES($1)', [provider]);
    const config = (await client.query('SELECT auth_provider FROM installation_config')).rows[0];
    if (config?.auth_provider !== provider)
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
  constructor(
    readonly options: {
      connectionString: string;
      encryptionKey: string;
      provider: Provider;
      authentication?: AuthenticationFactory;
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
  async switchProvider(provider: string) {
    await this.assertProvider();
    authProvider(provider);
    this.authentication(provider);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE "user",account,installation_config IN EXCLUSIVE MODE');
      const missing = await client.query(
        provider === 'local'
          ? 'SELECT id FROM "user" u WHERE NOT disabled AND NOT EXISTS(SELECT 1 FROM account a WHERE a."userId"=u.id AND a."providerId"=\'credential\' AND a.password IS NOT NULL)'
          : provider === 'clerk'
            ? 'SELECT id FROM "user" WHERE NOT disabled AND clerk_user_id IS NULL'
            : 'SELECT id FROM "user" u WHERE NOT disabled AND NOT EXISTS(SELECT 1 FROM account a WHERE a."userId"=u.id AND a."providerId"=$1)',
        !['local', 'clerk'].includes(provider) ? [`storypane:${provider}`] : [],
      );
      if (missing.rowCount)
        throw new Error('Migrate every active account by ID before switching providers');
      await client.query('DELETE FROM "session"');
      await client.query('DELETE FROM cms_sessions');
      await client.query('DELETE FROM verification');
      await client.query('UPDATE installation_config SET auth_provider=$1', [provider]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  authentication(provider = this.options.provider): Authentication {
    return (this.options.authentication ?? createAuthentication)({
      pool: this.pool,
      provider,
      appURL: process.env.STORYPANE_APP_URL ?? '',
      secret: process.env.BETTER_AUTH_SECRET,
      smtpURL: process.env.SMTP_URL,
      mailFrom: process.env.MAIL_FROM,
      clerkSecretKey: this.options.clerkSecretKey,
      clerkPublishableKey: this.options.clerkPublishableKey,
    });
  }
  async assertIdentity(userId: string, authentication = this.authentication()) {
    await this.assertProvider();
    const user = await this.pool.query('SELECT id FROM "user" WHERE id=$1 AND NOT disabled', [
      userId,
    ]);
    if (!user.rowCount)
      throw new StorypaneError('unauthenticated', 'Account is disabled or unavailable');
    await authentication.assertIdentity(userId);
  }
  async assertSession(
    actor: Pick<Actor, 'userId' | 'sessionId'>,
    authentication = this.authentication(),
  ) {
    if (!actor.userId || !actor.sessionId)
      throw new StorypaneError('unauthenticated', 'Sign in to continue');
    await this.assertProvider();
    const user = await this.pool.query('SELECT id FROM "user" WHERE id=$1 AND NOT disabled', [
      actor.userId,
    ]);
    if (!user.rowCount) throw new StorypaneError('unauthenticated', 'Your session has expired');
    await authentication.assertSession(actor);
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
        'SELECT id,name,description,status,mode,created_at,environment,clone_source_id FROM space_connections ORDER BY created_at,id',
      )
    ).rows as Array<{
      id: string;
      name: string;
      description: string;
      status: 'ready' | 'failed' | 'provisioning';
      mode: 'create' | 'attach' | 'import';
      environment: 'prod' | 'dev';
      clone_source_id: string | null;
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
  async acquire(spaceId: string, authentication = this.authentication()) {
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
        authorizeSession: async (actor) => {
          await this.assertSession(actor, authentication);
          if (
            !(
              await this.pool.query(
                "SELECT 1 FROM space_connections WHERE id=$1 AND status='ready'",
                [spaceId],
              )
            ).rowCount
          )
            throw new StorypaneError('unavailable', 'Space is no longer available');
        },
        authorizeIdentity: (userId) => this.assertIdentity(userId, authentication),
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

  canDeleteDatabase(row: { id: string; mode: string; connection_secret: string }) {
    if (row.mode !== 'create' || !this.options.provisioningURL) return false;
    const url = connectionURL(
      openConnection(row.connection_secret, this.options.encryptionKey, row.id),
    );
    const source = connectionURL(this.options.provisioningURL);
    const name = `sp_${row.id.replaceAll('-', '')}`;
    return (
      source.host === url.host &&
      url.pathname === `/${name}` &&
      decodeURIComponent(url.username) === name
    );
  }

  async deleteSpace(ownerId: string, raw: unknown) {
    if (!(await this.isAdmin(ownerId)))
      throw new StorypaneError('forbidden', 'Installation administrator access is required');
    const input = parseInput(
      z.object({ id: z.uuid(), name: z.string(), deleteDatabase: z.boolean().default(false) }),
      raw,
    );
    const lock = await this.pool.connect();
    let provisioner: Pool | undefined;
    try {
      await lock.query('SELECT pg_advisory_lock(hashtextextended($1,31))', [input.id]);
      await lock.query('BEGIN');
      const row = (
        await lock.query('SELECT * FROM space_connections WHERE id=$1 FOR UPDATE', [input.id])
      ).rows[0];
      if (!row) throw new StorypaneError('not_found', 'Space not found');
      let name = row.name;
      if (row.status === 'ready') {
        const selected = await this.acquire(input.id).catch(() => null);
        if (selected) {
          try {
            name = (await selected.db.query('SELECT name FROM spaces WHERE id=$1', [input.id]))
              .rows[0].name;
          } finally {
            await selected.close();
          }
        }
      }
      if (name !== input.name)
        throw new StorypaneError('invalid', 'Enter the space name to confirm deletion');
      if (
        (
          await lock.query(
            'SELECT 1 FROM space_connections WHERE production_space_id=$1 AND id<>$1',
            [input.id],
          )
        ).rowCount
      )
        throw new StorypaneError('invalid', 'Delete linked development spaces first');
      if (input.deleteDatabase) {
        if (!this.canDeleteDatabase(row))
          throw new StorypaneError(
            'invalid',
            'Only databases created by Storypane on the configured provisioning server can be deleted',
          );
        const source = connectionURL(this.options.provisioningURL!);
        const name = `sp_${input.id.replaceAll('-', '')}`;
        provisioner = new Pool({
          connectionString: source.href,
          max: 1,
          connectionTimeoutMillis: 5000,
        });
        const database = (
          await provisioner.query(
            'SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1',
            [name],
          )
        ).rows[0];
        if (database && database.owner !== name)
          throw new StorypaneError('invalid', 'Database ownership changed; deletion was stopped');
        await provisioner.query(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`);
      }
      await lock.query(
        'UPDATE space_connections SET clone_source_id=NULL WHERE clone_source_id=$1',
        [input.id],
      );
      await lock.query('DELETE FROM preview_routes WHERE space_id=$1', [input.id]);
      await lock.query('DELETE FROM space_connections WHERE id=$1', [input.id]);
      await lock.query('COMMIT');
    } catch (error) {
      await lock.query('ROLLBACK');
      throw error;
    } finally {
      lock.release(true);
      await provisioner?.end();
    }
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
  async reviewClone(
    actor: Pick<Actor, 'userId' | 'sessionId'>,
    raw: unknown,
  ): Promise<SchemaTransferReview> {
    if (!(await this.isAdmin(actor.userId)))
      throw new StorypaneError('forbidden', 'Installation administrator access is required');
    const input = parseInput(
      z
        .object({ id: z.uuid(), baseSpaceId: z.uuid(), environment: z.enum(['prod', 'dev']) })
        .strict(),
      raw,
    );
    const selected = await this.acquire(input.baseSpaceId);
    try {
      const sourceActor = { ...actor, spaceId: input.baseSpaceId, role: '' };
      const source = await captureSchema(selected.store, sourceActor);
      const deps = await collectSchemaDependencies(selected.store, sourceActor, source.definitions);
      return {
        id: input.id,
        token: schemaDigest({
          input,
          head: source.head.id,
          definitions: source.definitions,
          branch: source.branch,
          pending: source.pending,
          deps,
        }),
        action: 'clone',
        sourceSpaceId: input.baseSpaceId,
        targetSpaceId: input.id,
        conflicts: [],
        resolutions: {},
        dependencies: dependencySummary(deps),
        steps: [
          {
            id: source.head.id,
            name: `Clone ${source.space.name}`,
            changes: [],
            impacts: [],
            blockers: [],
          },
        ],
        confirmation: null,
      };
    } finally {
      await selected.close();
    }
  }
  async provision(
    ownerId: string,
    raw: unknown,
    context?: { actor: Pick<Actor, 'userId' | 'sessionId'>; copyAsset?: CopySchemaAsset },
  ) {
    if (!(await this.isAdmin(ownerId)))
      throw new StorypaneError('forbidden', 'Installation administrator access is required');
    const input = parseInput(
      spaceInputSchema.extend({
        id: z.uuid().optional(),
        mode: z.enum(['create', 'attach']),
        connectionString: z.string().optional(),
        environment: z.enum(['prod', 'dev']).optional(),
        baseSpaceId: z.uuid().optional(),
        reviewToken: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      }),
      raw,
    );
    const id = input.id ?? randomUUID();
    const environment = input.environment ?? 'prod';
    if (input.baseSpaceId && (!context || !input.reviewToken || input.baseSpaceId === id))
      throw new StorypaneError('invalid', 'Review the base space before cloning');
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
      if (
        row.clone_source_id &&
        (row.clone_source_id !== input.baseSpaceId || row.environment !== environment)
      )
        throw new StorypaneError('invalid', 'Cloning retry does not match');
      await lock.query(
        "UPDATE space_connections SET status='provisioning',environment=$2,clone_source_id=$3,clone_review_token=$4,clone_complete=CASE WHEN $3::uuid IS NULL THEN true ELSE clone_complete AND clone_source_id IS NOT NULL END WHERE id=$1",
        [id, environment, input.baseSpaceId ?? null, input.reviewToken ?? null],
      );
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
      const destination = new StorypaneStore(db, {
        spaceId: id,
        authorizeSession: (actor) => this.assertSession(actor),
        authorizeIdentity: (userId) => this.assertIdentity(userId),
      });
      if (input.baseSpaceId && context) {
        const selected = await this.acquire(input.baseSpaceId);
        try {
          const sourceActor: Actor = { ...context.actor, spaceId: input.baseSpaceId, role: '' };
          const source = await captureSchema(selected.store, sourceActor);
          const deps = await collectSchemaDependencies(
            selected.store,
            sourceActor,
            source.definitions,
          );
          const token = schemaDigest({
            input: { id, baseSpaceId: input.baseSpaceId, environment },
            head: source.head.id,
            definitions: source.definitions,
            branch: source.branch,
            pending: source.pending,
            deps,
          });
          const receipt = (await db.query('SELECT result FROM schema_transfers WHERE id=$1', [id]))
            .rows[0]?.result;
          const done = !!receipt;
          const targetActor: Actor = { ...context.actor, spaceId: id, role: 'admin' };
          const productionId =
            environment === 'dev'
              ? source.space.environment === 'prod'
                ? input.baseSpaceId
                : source.space.production_space_id
              : null;
          if (!done) {
            if (token !== input.reviewToken)
              throw new StorypaneError(
                'stale_revision',
                'The base space changed. Review the clone again.',
              );
            await copySchemaAssets(deps, id, context.copyAsset);
            await destination.schemaTransaction(targetActor, async (scoped, client) => {
              const imported = (
                await client.query('SELECT 1 FROM schema_transfers WHERE id=$1', [id])
              ).rowCount;
              if (imported) return;
              await client.query(
                'UPDATE spaces SET environment=$2,schema_read_only=$3,production_space_id=$4 WHERE id=$1',
                [id, environment, environment === 'prod', productionId],
              );
              const sourceDefault = deps.locales.find((l) => l.is_default);
              if (sourceDefault)
                await client.query(
                  'UPDATE space_locales SET name=$2,slug=$3 WHERE space_id=$1 AND is_default',
                  [id, sourceDefault.name, sourceDefault.slug],
                );
              const localeIds = await installSchemaConfiguration(client, id, deps);
              await installSchemaContent(client, targetActor, deps, localeIds, source.definitions);
              const migration = await scoped.pushMigration(targetActor, {
                formatVersion: 2,
                id: schemaIdentity([id, 'baseline']),
                spaceId: id,
                version: 1,
                baseVersion: 0,
                name: `Baseline from ${source.space.name}`.slice(0, 120),
                definitions: source.definitions,
                remoteRevision: null,
                sourceHash: null,
                status: 'active',
              });
              const review = await scoped.reviewMigration(targetActor, migration.id);
              if (review.blockers.length)
                throw new StorypaneError(
                  'invalid',
                  'Clone dependencies do not validate against the deployed schema',
                  review.blockers,
                );
              if (review.confirmation)
                throw new StorypaneError(
                  'invalid',
                  'Clone dependencies would lose data. Reconcile their schemas in the source first.',
                );
              await scoped.deployMigration(targetActor, migration.id, review.token);
              if (productionId)
                await client.query(
                  'INSERT INTO schema_branches(space_id,production_head,baseline,local_version,pending) VALUES($1,$2,$3,1,$4)',
                  [
                    id,
                    source.space.environment === 'prod'
                      ? source.head.id
                      : source.branch.production_head,
                    JSON.stringify(
                      source.space.environment === 'prod'
                        ? source.definitions
                        : source.branch.baseline,
                    ),
                    JSON.stringify(source.space.environment === 'prod' ? [] : source.pending),
                  ],
                );
              await client.query(
                'INSERT INTO schema_transfers(id,source_space_id,source_head,review_token,result) VALUES($1,$2,$3,$4,$5)',
                [
                  id,
                  input.baseSpaceId,
                  source.head.id,
                  token,
                  JSON.stringify({
                    sourceVersion: source.head.version,
                    definitions: source.definitions,
                  }),
                ],
              );
            });
            await lock.query(
              'UPDATE space_connections SET clone_complete=true,production_space_id=$2 WHERE id=$1',
              [id, productionId],
            );
          }
          await lock.query(
            'UPDATE space_connections SET clone_complete=true,production_space_id=$2 WHERE id=$1',
            [id, productionId],
          );
          if (
            environment === 'prod' &&
            source.space.environment === 'dev' &&
            !source.space.production_space_id
          ) {
            const baseline = schemaIdentity([id, 'baseline']);
            const imported = (
              await db.query('SELECT result FROM schema_transfers WHERE id=$1', [id])
            ).rows[0].result;
            await selected.store.schemaTransaction(sourceActor, async (_scoped, client) => {
              const current = (
                await client.query(
                  'SELECT production_space_id FROM spaces WHERE id=$1 FOR UPDATE',
                  [input.baseSpaceId],
                )
              ).rows[0];
              if (current.production_space_id && current.production_space_id !== id)
                throw new StorypaneError(
                  'stale_revision',
                  'The source dev space was linked to another production space',
                );
              await client.query('UPDATE spaces SET production_space_id=$2 WHERE id=$1', [
                input.baseSpaceId,
                id,
              ]);
              await client.query(
                'INSERT INTO schema_branches(space_id,production_head,baseline,local_version) VALUES($1,$2,$3,$4) ON CONFLICT(space_id) DO NOTHING',
                [
                  input.baseSpaceId,
                  baseline,
                  JSON.stringify(imported.definitions),
                  imported.sourceVersion,
                ],
              );
            });
            await lock.query('UPDATE space_connections SET production_space_id=$2 WHERE id=$1', [
              input.baseSpaceId,
              id,
            ]);
          }
        } finally {
          await selected.close();
        }
      } else
        await db.query('UPDATE spaces SET environment=$2,schema_read_only=$3 WHERE id=$1', [
          id,
          environment,
          input.environment === 'prod',
        ]);
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
