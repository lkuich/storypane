import { randomBytes, randomUUID } from 'node:crypto';
import { StorypaneError } from '@storypane/core';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import {
  Installation,
  migrateInstallation,
  sealConnection,
  openConnection,
  assertDedicatedRole,
  connectionURL,
} from './installation.js';
import {
  createLocalAccount,
  localAuth,
  recoverLocalAccount,
  migrateLocalCredential,
} from './local-auth.js';
import { Room, type RoomSocket } from '../../../apps/realtime/src/room';
import { acceptInvitation } from './accept-invitation.js';
import { resolveExternalIdentity, linkExternalIdentity } from './external-identity.js';
import type { AuthenticationFactory } from './authentication.js';

const mail = vi.hoisted(() => vi.fn(async (_message: { text: string }) => undefined));
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: mail }) }));

it('authenticates connection ciphertext and binds it to its space', () => {
  const key = randomBytes(32).toString('base64');
  const value = sealConnection('postgresql://role:secret@host/database', key, 'a');
  expect(value).not.toContain('secret');
  expect(openConnection(value, key, 'a')).toBe('postgresql://role:secret@host/database');
  expect(() => openConnection(value, key, 'b')).toThrow();
  expect(() => openConnection(value, randomBytes(32).toString('base64'), 'a')).toThrow();
});
it('rejects invalid installation keys before connecting or provisioning', () => {
  expect(
    () =>
      new Installation({
        connectionString: 'postgresql://unused',
        provider: 'local',
        encryptionKey: 'invalid',
      }),
  ).toThrow('must encode 32 bytes');
});
it('rejects connection parameters that override the recorded database or role', () => {
  expect(() => connectionURL('postgresql://role:secret@host/database?host=other')).toThrow(
    'Only sslmode',
  );
  expect(() => connectionURL('postgresql://role:secret@host/database?user=admin')).toThrow(
    'Only sslmode',
  );
});
// Dedicated disposable cluster: PUBLIC CONNECT changes must never target the normal dev cluster.
const url = process.env.ISOLATION_TEST_DATABASE_URL;
describe.skipIf(!url)('installation and actual PostgreSQL space isolation', () => {
  const admin = new Pool({ connectionString: url, max: 2 });
  const database = `installation_test_${randomUUID().replaceAll('-', '')}`;
  const target = new URL(url ?? 'postgresql://unused:unused@127.0.0.1:55449/postgres');
  target.pathname = `/${database}`;
  const installation = new Installation({
    connectionString: target.href,
    encryptionKey: randomBytes(32).toString('base64'),
    provider: 'local',
    provisioningURL: url,
  });
  let auth: ReturnType<typeof localAuth>;
  let user: { id: string; name: string; email: string };
  let actor: { userId: string; sessionId: string };
  let cookie: string;
  const spaces = [randomUUID(), randomUUID()];
  async function login(email = user.email, password = 'installation-test-password') {
    return auth.handler(
      new Request('http://localhost:3130/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3130',
          'x-forwarded-for': '127.0.0.1',
        },
        body: JSON.stringify({ email, password }),
      }),
    );
  }
  beforeAll(async () => {
    if (
      new URL(url ?? 'postgresql://unused:unused@127.0.0.1:55449/postgres').port !== '55449' ||
      new URL(url ?? 'postgresql://unused:unused@127.0.0.1:55449/postgres').hostname !== '127.0.0.1'
    )
      throw new Error('Isolation tests require the disposable localhost:55449 cluster');
    await admin.query('REVOKE CONNECT ON DATABASE postgres,template1 FROM PUBLIC');
    await admin.query(`CREATE DATABASE "${database}"`);
    await admin.query(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`);
    await migrateInstallation(installation.pool, 'local');
    auth = localAuth(installation.pool, {
      appURL: 'http://localhost:3130',
      secret: randomBytes(32).toString('base64'),
    });
    const client = await installation.pool.connect();
    try {
      await client.query('BEGIN');
      user = await createLocalAccount(
        client,
        { email: 'admin@isolation.test', name: 'Admin', password: 'installation-test-password' },
        true,
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const response = await login();
    expect(response.status, await response.clone().text()).toBe(200);
    cookie = response.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; ');
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    actor = { userId: user.id, sessionId: session!.session.id };
    for (const id of spaces)
      await installation.provision(user.id, { id, name: id, mode: 'create' });
    const selected = await installation.acquire(spaces[0]);
    try {
      await selected.store.seed({ ...actor, spaceId: spaces[0], role: 'admin' });
    } finally {
      await selected.close();
    }
  });
  afterAll(async () => {
    const rows = await installation.pool
      .query('SELECT id FROM space_connections')
      .catch(() => ({ rows: [] }));
    await installation.pool.end();
    for (const { id } of rows.rows) {
      const name = `sp_${id.replaceAll('-', '')}`;
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS "${name}"`);
    }
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.end();
  });
  it('authorizes space deletion, confirms its name, retains databases by default, and drops only managed databases on request', async () => {
    for (const deleteDatabase of [false, true]) {
      const id = randomUUID();
      const name = 'Deletion fixture';
      const databaseName = `sp_${id.replaceAll('-', '')}`;
      await installation.provision(user.id, { id, name, mode: 'create' });
      const selected = await installation.acquire(id);
      try {
        await expect(installation.deleteSpace('outsider', { id, name })).rejects.toMatchObject({
          code: 'forbidden',
        });
        await expect(
          installation.deleteSpace(user.id, { id, name: 'wrong' }),
        ).rejects.toMatchObject({ code: 'invalid' });
        await installation.pool.query("UPDATE space_connections SET mode='attach' WHERE id=$1", [
          id,
        ]);
        await expect(
          installation.deleteSpace(user.id, { id, name, deleteDatabase: true }),
        ).rejects.toMatchObject({ code: 'invalid' });
        await installation.pool.query("UPDATE space_connections SET mode='create' WHERE id=$1", [
          id,
        ]);
        await installation.pool.query(
          'UPDATE space_connections SET production_space_id=$1 WHERE id=$2',
          [id, spaces[0]],
        );
        await expect(
          installation.deleteSpace(user.id, { id, name, deleteDatabase }),
        ).rejects.toThrow('linked development');
        await installation.pool.query(
          'UPDATE space_connections SET production_space_id=NULL WHERE id=$1',
          [spaces[0]],
        );
        await selected.db.query('UPDATE spaces SET name=$2 WHERE id=$1', [id, 'Renamed fixture']);
        await installation.pool.query(
          "INSERT INTO preview_routes(token_hash,space_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
          [id, id],
        );
        if (deleteDatabase) await selected.close();
        await installation.deleteSpace(user.id, { id, name: 'Renamed fixture', deleteDatabase });
        if (!deleteDatabase)
          await expect(
            selected.store.getSpace({ ...actor, spaceId: id, role: 'admin' }),
          ).rejects.toMatchObject({ code: 'unavailable' });
        expect(
          (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [databaseName]))
            .rowCount,
        ).toBe(deleteDatabase ? 0 : 1);
        await expect(installation.acquire(id)).rejects.toMatchObject({ code: 'unavailable' });
      } finally {
        await selected.close();
        await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
        await admin.query(`DROP ROLE IF EXISTS "${databaseName}"`);
      }
    }
  });
  it('provisions independent databases with roles that cannot connect to the other database', async () => {
    const entries = await installation.pool.query(
      'SELECT id,connection_secret FROM space_connections ORDER BY id',
    );
    const connections = entries.rows.map(
      (row) =>
        new URL(openConnection(row.connection_secret, installation.options.encryptionKey, row.id)),
    );
    expect(connections[0].username).not.toBe(connections[1].username);
    const wrong = new URL(connections[0]);
    wrong.pathname = connections[1].pathname;
    const db = new Pool({ connectionString: wrong.href });
    try {
      await expect(db.query('SELECT 1')).rejects.toThrow('permission denied');
    } finally {
      await db.end();
    }
    const selected = await installation.acquire(spaces[0]);
    try {
      expect(
        (
          await selected.db.query(
            "SELECT to_regclass('session') AS sessions,to_regclass('account') AS accounts,to_regclass('cms_sessions') AS grants",
          )
        ).rows[0],
      ).toEqual({ sessions: null, accounts: null, grants: null });
      await expect(
        selected.store.getSpace({ ...actor, spaceId: spaces[1], role: 'admin' }),
      ).rejects.toThrow('binding mismatch');
      expect(
        (await selected.store.getSpace({ ...actor, spaceId: spaces[0], role: 'admin' })).id,
      ).toBe(spaces[0]);
    } finally {
      await selected.close();
    }
  });
  it('resumes duplicate provisioning without changing content and requires installation privileges', async () => {
    await expect(
      installation.provision(user.id, { id: spaces[0], name: 'retry', mode: 'create' }),
    ).resolves.toMatchObject({ id: spaces[0], status: 'ready' });
    expect((await installation.directory()).length).toBe(2);
    await expect(
      installation.provision('space-admin-only', { name: 'Denied', mode: 'create' }),
    ).rejects.toThrow('Installation administrator');
    await expect(migrateInstallation(installation.pool, 'clerk')).rejects.toThrow(
      'operator account migration',
    );
  });
  it('resumes after database creation was interrupted by a privilege failure', async () => {
    const blocker = `blocker_${randomUUID().replaceAll('-', '')}`;
    const id = randomUUID();
    await admin.query(`CREATE DATABASE "${blocker}"`);
    try {
      await expect(
        installation.provision(user.id, { id, name: 'Retry', mode: 'create' }),
      ).rejects.toThrow('other databases');
      expect(
        (await installation.pool.query('SELECT status FROM space_connections WHERE id=$1', [id]))
          .rows[0].status,
      ).toBe('failed');
      expect(
        (
          await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [
            `sp_${id.replaceAll('-', '')}`,
          ])
        ).rowCount,
      ).toBe(1);
      await admin.query(`REVOKE ALL ON DATABASE "${blocker}" FROM PUBLIC`);
      await installation.provision(user.id, { id, name: 'Retry', mode: 'create' });
      const selected = await installation.acquire(id);
      try {
        expect((await selected.db.query('SELECT count(*) FROM spaces')).rows[0].count).toBe('1');
      } finally {
        await selected.close();
      }
    } finally {
      await admin.query(`DROP DATABASE "${blocker}"`);
    }
  });
  it('attaches an empty dedicated database and preserves unrelated data on rejection', async () => {
    const id = randomUUID(),
      name = `sp_${id.replaceAll('-', '')}`;
    const target = new URL(url!);
    target.pathname = `/${name}`;
    target.username = name;
    target.password = 'attached-test-password';
    await admin.query(`CREATE ROLE "${name}" LOGIN PASSWORD 'attached-test-password'`);
    await admin.query(`CREATE DATABASE "${name}" OWNER "${name}"`);
    await admin.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    const attached = new Pool({ connectionString: target.href });
    try {
      await attached.query('CREATE TABLE unrelated(value text)');
      await attached.query("INSERT INTO unrelated VALUES('retain')");
      await expect(
        installation.provision(user.id, {
          id,
          name: 'Attached',
          mode: 'attach',
          connectionString: target.href,
        }),
      ).rejects.toThrow('empty database');
      expect((await attached.query('SELECT value FROM unrelated')).rows).toEqual([
        { value: 'retain' },
      ]);
      await attached.query('DROP TABLE unrelated');
      await installation.provision(user.id, { id, name: 'Attached', mode: 'attach' });
      expect((await attached.query('SELECT space_id FROM space_database')).rows[0].space_id).toBe(
        id,
      );
    } finally {
      await attached.end();
    }
  });
  it('rejects misbound registry entries and isolates failures while visiting spaces', async () => {
    const selected = await installation.acquire(spaces[1]);
    await selected.db.query('UPDATE space_database SET space_id=$1', [randomUUID()]);
    await selected.close();
    await expect(installation.acquire(spaces[1])).rejects.toThrow('binding mismatch');
    const visited: string[] = [];
    const failures = await installation.forEachSpace(async (id) => {
      const entry = await installation.acquire(id);
      try {
        visited.push(id);
      } finally {
        await entry.close();
      }
    });
    expect(visited).toContain(spaces[0]);
    expect(visited).not.toContain(spaces[1]);
    expect(failures).toEqual([spaces[1]]);
    const row = (
      await installation.pool.query('SELECT connection_secret FROM space_connections WHERE id=$1', [
        spaces[1],
      ])
    ).rows[0];
    const repair = new Pool({
      connectionString: openConnection(
        row.connection_secret,
        installation.options.encryptionKey,
        spaces[1],
      ),
    });
    try {
      await repair.query('UPDATE space_database SET space_id=$1', [spaces[1]]);
    } finally {
      await repair.end();
    }
  });
  it('accepts manual invitations once without verifying email or claiming an existing account', async () => {
    const selected = await installation.acquire(spaces[0]);
    try {
      const invited = await selected.store.inviteSpaceMember(
        { ...actor, spaceId: spaces[0], role: 'admin' },
        { email: 'invite@isolation.test', role: 'editor' },
      );
      const input = {
        spaceId: spaces[0],
        token: invited.token,
        name: 'Invited',
        password: 'invitation-test-password',
      };
      await acceptInvitation(installation, input);
      await expect(acceptInvitation(installation, input)).rejects.toThrow('already used');
      const invitedUser = (
        await installation.pool.query('SELECT id,"emailVerified" FROM "user" WHERE email=$1', [
          'invite@isolation.test',
        ])
      ).rows[0];
      expect(invitedUser.emailVerified).toBe(false);
      const second = await installation.acquire(spaces[1]);
      try {
        const invitation = await second.store.inviteSpaceMember(
          { ...actor, spaceId: spaces[1], role: 'admin' },
          { email: 'invite@isolation.test', role: 'viewer' },
        );
        await expect(
          acceptInvitation(installation, { ...input, spaceId: spaces[1], token: invitation.token }),
        ).rejects.toThrow('existing account');
        await acceptInvitation(
          installation,
          { spaceId: spaces[1], token: invitation.token },
          invitedUser.id,
        );
      } finally {
        await second.close();
      }
    } finally {
      await selected.close();
    }
  });
  it('routes opaque previews and keeps tokens, snapshots and WebSockets within their database', async () => {
    const selected = await installation.acquire(spaces[0]),
      other = await installation.acquire(spaces[1]);
    const editor = { ...actor, spaceId: spaces[0], role: 'admin' };
    try {
      const story = (await selected.store.listStories(editor))[0];
      const locale = (await selected.store.listLocales(editor, story.id))[0];
      const previewId = randomUUID();
      await selected.store.updateDeliverySettings(editor, {
        previewUrls: [{ id: previewId, name: 'Test', url: 'http://localhost:3131/{slug}' }],
        defaultPreviewId: previewId,
        previewParameter: 'storypane_preview',
      });
      const preview = await selected.store.createEditorPreview(editor, story.id, locale.id);
      expect(await installation.resolvePreview(preview.token)).toBe(spaces[0]);
      await expect(
        other.store.authenticatePreview(preview.token, 'http://localhost:3131'),
      ).rejects.toThrow();
      await expect(
        selected.store.authenticatePreview(preview.token, 'https://wrong.test'),
      ).rejects.toThrow();
      const connection = await selected.store.authenticatePreview(
        preview.token,
        'http://localhost:3131',
      );
      const token = await selected.store.createDeliveryToken(editor, {
        name: 'Website',
        scope: 'published',
      });
      await expect(other.store.publishedStories(token.token, spaces[1], {})).rejects.toThrow();
      expect(
        (await selected.store.publishedStories(token.token, spaces[0], {})).stories,
      ).toHaveLength(0);
      const management = await selected.store.createManagementToken(editor, {
        name: 'Management',
        scopes: ['read'],
      });
      await expect(
        other.store.authenticateManagement(management.token, spaces[1], 'stories'),
      ).rejects.toThrow();
      const room = new Room(
        { getWebSockets: () => [] },
        {
          withStore: async (run) => {
            const entry = await installation.acquire(spaces[0]);
            try {
              return await run(entry.store);
            } finally {
              await entry.close();
            }
          },
        },
      );
      const socket: RoomSocket = {
        send: vi.fn(),
        close: vi.fn(),
        deserializeAttachment: () => ({
          actor: editor,
          storyId: story.id,
          localeId: locale.id,
          previewSessionId: connection.id,
        }),
      };
      await room.webSocketMessage(socket, JSON.stringify({ type: 'sync' }));
      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('content'));
      await installation.pool.query('UPDATE "user" SET disabled=true WHERE id=$1', [user.id]);
      await expect(selected.store.previewStory(connection.id)).rejects.toThrow('expired');
      await expect(
        selected.store.assertActor(
          await selected.store.authenticateManagement(management.token, spaces[0], 'stories'),
        ),
      ).rejects.toThrow('disabled');
      await room.webSocketMessage(socket, JSON.stringify({ type: 'sync' }));
      expect(socket.close).toHaveBeenCalledWith(1008, 'Authentication expired');
      await installation.pool.query('UPDATE "user" SET disabled=false WHERE id=$1', [user.id]);
    } finally {
      await selected.close();
      await other.close();
    }
  });
  it('requires explicit migration by ID for local credentials while preserving Clerk mappings', async () => {
    const client = await installation.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO "user"(id,name,email,clerk_user_id) VALUES('imported','Imported','Imported@Identity.Test','user_imported')`,
      );
      await client.query(
        `INSERT INTO cms_sessions VALUES('imported-grant','imported',now()+interval '1 hour')`,
      );
      await migrateLocalCredential(client, 'imported', 'migrated-test-password');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(
      (
        await installation.pool.query(
          'SELECT email,clerk_user_id FROM "user" WHERE id=\'imported\'',
        )
      ).rows[0],
    ).toEqual({ email: 'imported@identity.test', clerk_user_id: 'user_imported' });
    expect(
      (await installation.pool.query("SELECT 1 FROM cms_sessions WHERE user_id='imported'"))
        .rowCount,
    ).toBe(0);
    expect((await login('imported@identity.test', 'migrated-test-password')).status).toBe(200);
  });
  it('rejects role memberships and wrong-space connection replacements', async () => {
    const row = (
      await installation.pool.query('SELECT connection_secret FROM space_connections WHERE id=$1', [
        spaces[0],
      ])
    ).rows[0];
    const connection = openConnection(
      row.connection_secret,
      installation.options.encryptionKey,
      spaces[0],
    );
    await expect(installation.updateConnection(user.id, spaces[1], connection)).rejects.toThrow(
      'another space',
    );
    const selected = await installation.acquire(spaces[0]);
    const role = `sp_${spaces[0].replaceAll('-', '')}`,
      group = `group_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE ROLE "${group}"`);
    try {
      await admin.query(`GRANT "${group}" TO "${role}"`);
      await expect(assertDedicatedRole(selected.db)).rejects.toThrow('role memberships');
    } finally {
      await admin.query(`REVOKE "${group}" FROM "${role}"`);
      await admin.query(`DROP ROLE "${group}"`);
      await selected.close();
    }
    await installation.updateConnection(user.id, spaces[0], connection);
  });
  it('persists authentication rate limits across application instances', async () => {
    for (let i = 0; i < 10; i++) await installation.authAttempt('account-login');
    const second = new Installation(installation.options);
    try {
      await expect(second.authAttempt('account-login')).rejects.toThrow('Too many');
    } finally {
      await second.pool.end();
    }
  });
  it('revokes password-reset sessions using Better Auth with optional mail delivery', async () => {
    const client = await installation.pool.connect();
    try {
      await client.query('BEGIN');
      await createLocalAccount(client, {
        email: 'reset@isolation.test',
        name: 'Reset',
        password: 'before-reset-password',
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const smtp = localAuth(installation.pool, {
      appURL: 'http://localhost:3130',
      secret: randomBytes(32).toString('base64'),
      smtpURL: 'smtp://localhost:25',
      mailFrom: 'cms@isolation.test',
    });
    const request = (path: string, body: unknown) =>
      smtp.handler(
        new Request(`http://localhost:3130/api/auth/${path}`, {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:3130',
            'Content-Type': 'application/json',
            'x-forwarded-for': '127.0.0.9',
          },
          body: JSON.stringify(body),
        }),
      );
    const signedIn = await request('sign-in/email', {
      email: 'reset@isolation.test',
      password: 'before-reset-password',
    });
    expect(signedIn.status).toBe(200);
    const headers = new Headers({
      cookie: signedIn.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; '),
    });
    expect(await smtp.api.getSession({ headers })).not.toBeNull();
    expect(
      (
        await request('request-password-reset', {
          email: 'reset@isolation.test',
          redirectTo: 'http://localhost:3130/',
        })
      ).status,
    ).toBe(200);
    const link = mail.mock.calls.at(-1)![0].text.split(' ').at(-1)!;
    const token = new URL(link).pathname.split('/').at(-1);
    expect(
      (await request('reset-password', { token, newPassword: 'after-reset-password' })).status,
    ).toBe(200);
    expect(await smtp.api.getSession({ headers })).toBeNull();
  });
  it('clones deployed hierarchy and only required content/media, with retryable private copies', async () => {
    const selected = await installation.acquire(spaces[0]);
    const sourceActor = { ...actor, spaceId: spaces[0], role: 'admin' };
    const cloneId = randomUUID();
    try {
      const source = selected.store;
      const story = (
        await selected.db.query('SELECT id FROM stories WHERE space_id=$1 LIMIT 1', [spaces[0]])
      ).rows[0];
      const locale = (
        await selected.db.query('SELECT id FROM story_locales WHERE story_id=$1 LIMIT 1', [
          story.id,
        ])
      ).rows[0];
      const snapshot = await source.getSnapshot(sourceActor, story.id, locale.id);
      await source.command(sourceActor, story.id, locale.id, {
        mutationId: randomUUID(),
        expectedRevisions: {},
        leaseTokens: {},
        type: 'publishCheckpoint',
        payload: { checkpointId: snapshot.checkpointId! },
      });
      const definitions = await source.listDefinitions(sourceActor);
      const page = definitions.find((d) => d.name === 'page')!;
      const hero = definitions.find((d) => d.name === 'hero')!;
      await source.moveDefinition(sourceActor, hero.id, {
        parentDefinitionId: page.id,
        expectedParentDefinitionId: null,
      });
      const assetId = randomUUID();
      await selected.db.query(
        "INSERT INTO assets(id,space_id,object_key,filename,mime_type,byte_size,title) VALUES($1,$2,$3,'required.png','image/png',16,'Required image')",
        [assetId, spaces[0], `${spaces[0]}/original/${assetId}`],
      );
      const datasource = await source.saveDatasource(sourceActor, {
        name: 'Choices',
        slug: 'choices',
        items: [{ value: 'one', label: 'One' }],
      });
      await source.createDefinition(
        sourceActor,
        {
          name: 'defaults',
          displayName: 'Defaults',
          kind: 'nestable',
          fields: [
            {
              name: 'page',
              label: 'Page',
              type: 'link',
              defaultValue: { type: 'story', storyId: story.id },
            },
            { name: 'image', label: 'Image', type: 'asset', defaultValue: { assetId } },
            {
              name: 'choice',
              label: 'Choice',
              type: 'option',
              source: { type: 'datasource', datasourceId: datasource.id },
              defaultValue: 'one',
            },
            {
              name: 'body',
              label: 'Body',
              type: 'blocks',
              allowedDefinitionIds: [hero.id],
              maxItems: 3,
            },
          ],
        },
        undefined,
        hero.id,
      );
      const migration = (await source.listMigrations(sourceActor)).find(
        (m) => m.status === 'active',
      )!;
      const review = await source.reviewMigration(sourceActor, migration.id);
      await source.deployMigration(sourceActor, migration.id, review.token);
      await selected.db.query(
        "UPDATE block_drafts SET fields=jsonb_set(fields,'{title}',$2::jsonb) WHERE id=$1",
        [snapshot.locale.rootBlockId, JSON.stringify('Unfinished title')],
      );
      const cloneReview = await installation.reviewClone(actor, {
        id: cloneId,
        baseSpaceId: spaces[0],
        environment: 'dev',
      });
      expect(cloneReview.dependencies.stories).toEqual([{ id: story.id, name: 'Home' }]);
      expect(cloneReview.dependencies.assets).toHaveLength(1);
      const input = {
        id: cloneId,
        name: 'Linked dev',
        mode: 'create',
        baseSpaceId: spaces[0],
        environment: 'dev',
        reviewToken: cloneReview.token,
      };
      await expect(
        installation.provision(user.id, input, {
          actor,
          copyAsset: async () => {
            throw new Error('Interrupted media copy');
          },
        }),
      ).rejects.toThrow('Interrupted media copy');
      await expect(installation.acquire(cloneId)).rejects.toThrow('not ready');
      const copy = vi.fn(async () => undefined);
      await installation.provision(user.id, input, { actor, copyAsset: copy });
      await installation.provision(user.id, input, { actor, copyAsset: copy });
      expect(copy).toHaveBeenCalledTimes(1);
      expect(copy.mock.calls[0]).toMatchObject([{ id: assetId }, `${cloneId}/schema/${assetId}`]);
      const target = await installation.acquire(cloneId);
      try {
        const targetActor = { ...actor, spaceId: cloneId, role: 'admin' };
        const space = await target.store.getSpace(targetActor);
        expect(space).toMatchObject({
          environment: 'dev',
          productionSpaceId: spaces[0],
          schemaReadOnly: false,
          storyCount: 1,
        });
        const schema = await target.store.listDefinitions(targetActor, true);
        expect(schema.find((d) => d.id === hero.id)?.parentDefinitionId).toBe(page.id);
        expect(schema.find((d) => d.name === 'defaults')?.parentDefinitionId).toBe(hero.id);
        expect(schema.find((d) => d.name === 'defaults')?.fields.at(-1)).toMatchObject({
          allowedDefinitionIds: [hero.id],
          maxItems: 3,
        });
        const copied = await target.store.getSnapshot(targetActor, story.id, locale.id);
        expect(copied.locale.publishedVersionId).toBeNull();
        expect(copied.blocks.find((b) => b.id === copied.locale.rootBlockId)?.fields.title).toBe(
          'Home',
        );
        expect(copied.blocks).toHaveLength(snapshot.blocks.length);
        expect(
          (await target.db.query('SELECT object_key FROM assets WHERE id=$1', [assetId])).rows[0]
            .object_key,
        ).toBe(`${cloneId}/schema/${assetId}`);
        expect((await target.store.listDatasources(targetActor))[0].items).toEqual([
          { value: 'one', label: 'One' },
        ]);
        expect(await target.store.listManagementTokens(targetActor)).toEqual([]);
      } finally {
        await target.close();
      }
    } finally {
      await selected.close();
    }
  });
  it('starts in dev, creates protected production, and links the original dev baseline', async () => {
    const devId = randomUUID(),
      prodId = randomUUID();
    await installation.provision(user.id, {
      id: devId,
      name: 'Dev first',
      mode: 'create',
      environment: 'dev',
    });
    const reviewed = await installation.reviewClone(actor, {
      id: prodId,
      baseSpaceId: devId,
      environment: 'prod',
    });
    await installation.provision(
      user.id,
      {
        id: prodId,
        name: 'Production from dev',
        mode: 'create',
        environment: 'prod',
        baseSpaceId: devId,
        reviewToken: reviewed.token,
      },
      { actor },
    );
    const dev = await installation.acquire(devId),
      prod = await installation.acquire(prodId);
    try {
      expect(await dev.store.getSpace({ ...actor, spaceId: devId, role: 'admin' })).toMatchObject({
        environment: 'dev',
        productionSpaceId: prodId,
      });
      expect(await prod.store.getSpace({ ...actor, spaceId: prodId, role: 'admin' })).toMatchObject(
        { environment: 'prod', schemaReadOnly: true },
      );
      expect((await dev.db.query('SELECT production_head FROM schema_branches')).rows).toHaveLength(
        1,
      );
    } finally {
      await dev.close();
      await prod.close();
    }
  });
  it('supports a custom provider through the same store, preview and realtime boundaries without granting access on sign-in', async () => {
    const customDB = `custom_auth_${randomUUID().replaceAll('-', '')}`;
    const customURL = new URL(url!);
    customURL.pathname = `/${customDB}`;
    await admin.query(`CREATE DATABASE "${customDB}"`);
    await admin.query(`REVOKE ALL ON DATABASE "${customDB}" FROM PUBLIC`);
    let sessionActive = true,
      identityActive = true;
    let scopes = 0;
    const factory: AuthenticationFactory = () => {
      scopes++;
      return {
        config: () => ({
          provider: 'redirect',
          name: 'Okta',
          signInPath: '/api/auth/sign-in/okta',
        }),
        getSession: async () => null,
        assertSession: async () => {
          if (!sessionActive) throw new StorypaneError('unauthenticated', 'Session revoked');
        },
        assertIdentity: async () => {
          if (!identityActive) throw new StorypaneError('unauthenticated', 'Identity disabled');
        },
        handle: async () => new Response('Not found', { status: 404 }),
      };
    };
    const custom = new Installation({
      connectionString: customURL.href,
      provider: 'okta',
      authentication: factory,
      encryptionKey: randomBytes(32).toString('base64'),
      provisioningURL: url,
    });
    const customSpace = randomUUID();
    try {
      await migrateInstallation(custom.pool, 'okta');
      await migrateInstallation(custom.pool, 'okta');
      expect(
        (await custom.pool.query('SELECT count(*)::int AS count FROM installation_migrations'))
          .rows[0].count,
      ).toBe(3);
      await expect(migrateInstallation(custom.pool, 'local')).rejects.toThrow(
        'operator account migration',
      );
      const claims = {
        provider: 'okta',
        subject: 'subject-123',
        name: 'Okta editor',
        email: 'editor@okta.test',
        emailVerified: true,
      };
      await expect(
        resolveExternalIdentity(custom.pool, { ...claims, emailVerified: false }),
      ).rejects.toMatchObject({ code: 'invalid' });
      const identity = await resolveExternalIdentity(custom.pool, claims);
      expect((await resolveExternalIdentity(custom.pool, claims)).id).toBe(identity.id);
      expect(
        (
          await custom.pool.query('SELECT installation_admin FROM "user" WHERE id=$1', [
            identity.id,
          ])
        ).rows[0].installation_admin,
      ).toBe(false);
      // Same email must never link a different external subject to this account.
      await expect(
        resolveExternalIdentity(custom.pool, { ...claims, subject: 'different' }),
      ).rejects.toThrow();
      await linkExternalIdentity(custom.pool, 'okta', claims.subject, identity.id);
      const other = await resolveExternalIdentity(custom.pool, {
        ...claims,
        subject: 'second',
        email: 'second@okta.test',
      });
      await expect(
        linkExternalIdentity(custom.pool, 'okta', claims.subject, other.id),
      ).rejects.toThrow('already linked');
      await expect(
        custom.provision(identity.id, { id: customSpace, name: 'Custom auth', mode: 'create' }),
      ).rejects.toThrow();
      await custom.pool.query('UPDATE "user" SET installation_admin=true WHERE id=$1', [
        identity.id,
      ]);
      await custom.provision(identity.id, { id: customSpace, name: 'Custom auth', mode: 'create' });
      const selected = await custom.acquire(customSpace);
      const customActor = {
        userId: identity.id,
        sessionId: 'test-provider-session',
        spaceId: customSpace,
        role: 'admin',
      };
      try {
        await expect(
          selected.store.getSpace({ ...customActor, userId: other.id }),
        ).rejects.toThrow();
        await selected.store.seed(customActor);
        const story = await selected.store.createStory(customActor, {
          name: 'Provider page',
          slug: 'provider-page',
          definitionId: (await selected.store.listDefinitions(customActor)).find(
            (definition) => definition.kind === 'content-type',
          )!.id,
        });
        const configId = randomUUID();
        await selected.store.updateDeliverySettings(customActor, {
          previewUrls: [{ id: configId, name: 'Preview', url: 'https://preview.test/{slug}' }],
          defaultPreviewId: configId,
          previewParameter: 'storypane_preview',
        });
        const preview = await selected.store.createEditorPreview(
          customActor,
          story.story.id,
          story.locale.id,
        );
        const connection = await selected.store.authenticatePreview(
          preview.token,
          'https://preview.test',
        );
        const token = await selected.store.createManagementToken(customActor, {
          name: 'Custom auth',
          scopes: ['read'],
        });
        const managementActor = await selected.store.authenticateManagement(
          token.token,
          customSpace,
          'stories',
        );
        await selected.store.assertActor(managementActor);
        sessionActive = false;
        await expect(
          selected.store.getSnapshot(customActor, story.story.id, story.locale.id),
        ).rejects.toThrow('revoked');
        await expect(selected.store.previewStory(connection.id)).rejects.toThrow('revoked');
        const socket: RoomSocket = {
          send: vi.fn(),
          close: vi.fn(),
          deserializeAttachment: () => ({
            actor: customActor,
            storyId: story.story.id,
            localeId: story.locale.id,
          }),
        };
        const room = new Room(
          { getWebSockets: () => [socket] },
          {
            withStore: async (run) => {
              const scope = await custom.acquire(customSpace);
              try {
                return await run(scope.store);
              } finally {
                await scope.close();
              }
            },
          },
        );
        await room.webSocketMessage(socket, JSON.stringify({ type: 'sync' }));
        expect(socket.close).toHaveBeenCalledWith(1008, 'Authentication expired');
        sessionActive = true;
        identityActive = false;
        await expect(selected.store.assertActor(managementActor)).rejects.toThrow('disabled');
        identityActive = true;
        await custom.pool.query('UPDATE "user" SET disabled=true WHERE id=$1', [identity.id]);
        await expect(selected.store.getSpace(customActor)).rejects.toMatchObject({
          code: 'unauthenticated',
        });
        await expect(resolveExternalIdentity(custom.pool, claims)).rejects.toThrow('disabled');
        await expect(custom.switchProvider('local')).rejects.toThrow(
          'Migrate every active account',
        );
        expect(
          (await custom.pool.query('SELECT auth_provider FROM installation_config')).rows[0]
            .auth_provider,
        ).toBe('okta');
        const migrationClient = await custom.pool.connect();
        try {
          await migrationClient.query('BEGIN');
          await migrateLocalCredential(migrationClient, other.id, 'provider-migration-password');
          await migrationClient.query('COMMIT');
        } finally {
          migrationClient.release();
        }
        await custom.pool.query(
          "INSERT INTO cms_sessions VALUES('old-provider-session',$1,now()+interval '1 hour')",
          [other.id],
        );
        await custom.switchProvider('local');
        expect(
          (await custom.pool.query('SELECT auth_provider FROM installation_config')).rows[0]
            .auth_provider,
        ).toBe('local');
        expect((await custom.pool.query('SELECT * FROM cms_sessions')).rows).toHaveLength(0);
        expect(
          (
            await custom.pool.query(
              'SELECT count(*)::int AS count FROM account WHERE "providerId"=$1',
              ['storypane:okta'],
            )
          ).rows[0].count,
        ).toBe(2);
        await expect(custom.assertSession(customActor)).rejects.toMatchObject({
          code: 'unavailable',
        });
        expect(scopes).toBeGreaterThan(1);
      } finally {
        await selected.close();
      }
    } finally {
      await custom.pool.end();
      await admin.query(
        `DROP DATABASE IF EXISTS "sp_${customSpace.replaceAll('-', '')}" WITH (FORCE)`,
      );
      await admin.query(`DROP ROLE IF EXISTS "sp_${customSpace.replaceAll('-', '')}"`);
      await admin.query(`DROP DATABASE "${customDB}" WITH (FORCE)`);
    }
  });
  it('denies public signup and bad origins; recovery revokes all sessions', async () => {
    const signup = await auth.handler(
      new Request('http://localhost:3130/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3130' },
        body: JSON.stringify({
          name: 'Intruder',
          email: 'intruder@test.com',
          password: 'intruder-test-password',
        }),
      }),
    );
    expect(signup.status).not.toBe(200);
    const bad = await auth.handler(
      new Request('http://localhost:3130/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.test', cookie },
        body: JSON.stringify({ email: user.email, password: 'installation-test-password' }),
      }),
    );
    expect(bad.status).toBe(403);
    await installation.assertSession(actor);
    const client = await installation.pool.connect();
    try {
      await client.query('BEGIN');
      await recoverLocalAccount(client, user.email, 'replacement-test-password');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await expect(installation.assertSession(actor)).rejects.toThrow('expired');
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });
});
