import { randomUUID, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { it, expect } from 'vitest';
import { Installation, migrateInstallation, migrateSpace } from './installation.js';
import { migrate } from './migrate.js';
import { StorypaneStore } from './store.js';
import { splitLegacy } from './split-legacy.js';
import { verifyMigratedExamples } from '../../../tests/migrated-examples';

const url = process.env.ISOLATION_TEST_DATABASE_URL;
it.skipIf(!url).each([false, true])(
  'copies and validates legacy spaces, releases, tokens and media (pre-release schema: %s)',
  async (legacySchedules) => {
    if (new URL(url!).hostname !== '127.0.0.1' || new URL(url!).port !== '55449')
      throw new Error('Use the disposable isolation cluster');
    const admin = new Pool({ connectionString: url });
    const prefix = `split_${randomUUID().replaceAll('-', '')}`;
    const names = [`${prefix}_source`, `${prefix}_control`, `${prefix}_a`, `${prefix}_b`];
    const pools: Pool[] = [];
    let installation: Installation | undefined;
    try {
      await admin.query('REVOKE CONNECT ON DATABASE postgres,template1 FROM PUBLIC');
      for (const name of names) {
        await admin.query(`CREATE ROLE "${name}" LOGIN PASSWORD 'split-test-password'`);
        await admin.query(`CREATE DATABASE "${name}" OWNER "${name}"`);
        await admin.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
      }
      const urls = names.map((name) => {
        const target = new URL(url!);
        target.pathname = `/${name}`;
        target.username = name;
        target.password = 'split-test-password';
        return target.href;
      });
      const source = new Pool({ connectionString: urls[0], max: 2 });
      pools.push(source);
      await migrate(source);
      await expect(migrateSpace(source)).rejects.toThrow('legacy source');
      await source.query(
        `INSERT INTO "user"(id,name,email,clerk_user_id) VALUES('legacy-admin','Admin','legacy@split.test','user_clerk')`,
      );
      await source.query(
        `INSERT INTO cms_sessions VALUES('legacy-session','legacy-admin',now()+interval '1 hour')`,
      );
      await source.query(
        `INSERT INTO "user"(id,name,email) VALUES('reviewer','Reviewer','reviewer@split.test');
         INSERT INTO cms_sessions VALUES('reviewer-session','reviewer',now()+interval '1 hour')`,
      );
      const store = new StorypaneStore(source);
      const ids = [randomUUID(), randomUUID()];
      const tokens: string[] = [];
      const transfers: string[] = [];
      const discussions: string[] = [];
      for (const spaceId of ids) {
        const actor = {
          spaceId,
          userId: 'legacy-admin',
          sessionId: 'legacy-session',
          role: 'admin',
        };
        await store.seed(actor);
        const story = (await store.listStories(actor))[0],
          locale = (await store.listLocales(actor, story.id))[0];
        const snapshot = await store.getSnapshot(actor, story.id, locale.id);
        await store.command(actor, story.id, locale.id, {
          mutationId: randomUUID(),
          expectedRevisions: {},
          leaseTokens: {},
          type: 'publishCheckpoint',
          payload: { checkpointId: snapshot.checkpointId! },
        });
        const hero = snapshot.blocks.find(
          (block) =>
            snapshot.definitions.find((d) => d.versionId === block.schemaVersionId)?.name ===
            'hero',
        )!;
        const lease = await store.acquireLease(actor, story.id, locale.id, hero.id);
        await store.command(actor, story.id, locale.id, {
          mutationId: randomUUID(),
          expectedRevisions: { [hero.id]: hero.revision },
          leaseTokens: { [hero.id]: lease.token! },
          type: 'saveBlock',
          payload: { blockId: hero.id, fields: { ...hero.fields, title: 'Unfinished draft' } },
        });
        tokens.push(
          (await store.createDeliveryToken(actor, { name: 'Website', scope: 'published' })).token,
        );
        await store.createManagementToken(actor, { name: 'Management', scopes: ['read'] });
        await store.inviteSpaceMember(actor, { email: 'pending@split.test', role: 'viewer' });
        await source.query(
          "INSERT INTO assets(id,space_id,object_key,filename,mime_type,byte_size,title) VALUES($1,$2,$3,'photo.png','image/png',12,'Photo')",
          [randomUUID(), spaceId, `${spaceId}/original.png`],
        );
        const localTime = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
        await store.schedulePublication(actor, story.id, locale.id, {
          requestId: randomUUID(),
          checkpointId: snapshot.checkpointId!,
          localTime,
          dueAt: `${localTime}:00.000Z`,
          timezone: 'UTC',
          expectedScheduleId: null,
          expectedRevision: null,
          releaseName: 'Preserved launch',
        });
        await source.query(
          "INSERT INTO memberships(space_id,user_id,role) VALUES($1,'reviewer','editor')",
          [spaceId],
        );
        const team = await store.saveTeam(actor, {
          name: 'Editorial',
          memberIds: ['reviewer'],
          minimumApprovals: 1,
        });
        const version = (
          await store.reviewDirectory(actor, { storyId: story.id, localeId: locale.id })
        ).version;
        const discussion = await store.createDiscussion(actor, {
          storyId: story.id,
          localeId: locale.id,
          kind: 'review',
          teamIds: [team.id],
          message: `Review for ${spaceId}`,
          expectedVersion: version,
        });
        discussions.push(discussion.id);
        await store.actOnDiscussion(
          { ...actor, userId: 'reviewer', sessionId: 'reviewer-session' },
          discussion.id,
          {
            action: 'approve',
            expectedVersion: version,
          },
        );
        const transferId = randomUUID();
        transfers.push(transferId);
        await source.query(
          'INSERT INTO schema_transfers(id,source_space_id,source_head,review_token,result) VALUES($1,$2,$3,$4,$5),($6,$2,$3,$4,$7)',
          [
            spaceId,
            ids.find((id) => id !== spaceId),
            randomUUID(),
            'retained-review-token',
            JSON.stringify({ sourceVersion: 1, definitions: [] }),
            transferId,
            JSON.stringify({ action: 'promote', targetSpaceId: spaceId, steps: [] }),
          ],
        );
      }
      if (legacySchedules)
        await source.query(
          "DROP TRIGGER page_connections_changed ON story_locales; DROP FUNCTION update_page_connections(); DROP FUNCTION refresh_page_connections(uuid); DROP TABLE page_connections; DELETE FROM storypane_migrations WHERE name='028_page_connections'; DROP TRIGGER content_release_members_changed ON publication_schedules; DROP FUNCTION bump_content_release_revision(); ALTER TABLE publication_schedules DROP COLUMN release_id,DROP COLUMN approved_snapshot,DROP COLUMN cancelled_by_release; DROP TABLE content_releases; DELETE FROM storypane_migrations WHERE name='027_content_releases'",
        );
      installation = new Installation({
        connectionString: urls[1],
        encryptionKey: randomBytes(32).toString('base64'),
        provider: 'clerk',
      });
      await migrateInstallation(installation.pool, 'clerk');
      const history = (
        await source.query('SELECT name,applied_at FROM storypane_migrations ORDER BY name')
      ).rows;
      expect(
        await splitLegacy(
          installation,
          source,
          { [ids[0]]: urls[2], [ids[1]]: urls[3] },
          'legacy-admin',
        ),
      ).toEqual({ spaces: 2, identities: 2 });
      expect(
        (
          await installation.pool.query(
            'SELECT clerk_user_id,installation_admin FROM "user" ORDER BY id',
          )
        ).rows,
      ).toEqual([
        { clerk_user_id: 'user_clerk', installation_admin: true },
        { clerk_user_id: null, installation_admin: false },
      ]);
      for (const [index, id] of ids.entries()) {
        const selected = await installation.acquire(id);
        try {
          expect((await selected.db.query('SELECT id FROM spaces')).rows).toEqual([{ id }]);
          expect((await selected.db.query('SELECT id FROM discussions')).rows).toEqual([
            { id: discussions[index] },
          ]);
          expect(
            (await selected.db.query('SELECT DISTINCT discussion_id FROM discussion_messages'))
              .rows,
          ).toEqual([{ discussion_id: discussions[index] }]);
          expect(
            (await selected.db.query('SELECT discussion_id,user_id,decision FROM review_decisions'))
              .rows,
          ).toEqual([
            { discussion_id: discussions[index], user_id: 'reviewer', decision: 'approve' },
          ]);
          expect(
            (await selected.db.query('SELECT space_id,name,minimum_approvals FROM teams')).rows,
          ).toEqual([{ space_id: id, name: 'Editorial', minimum_approvals: 1 }]);
          expect(
            (await selected.db.query('SELECT id FROM schema_transfers ORDER BY id')).rows,
          ).toEqual([id, transfers[index]].sort().map((id) => ({ id })));
          expect(
            (
              await selected.db.query(
                'SELECT name,applied_at FROM storypane_migrations WHERE name=ANY($1::text[]) ORDER BY name',
                [history.map((row) => row.name)],
              )
            ).rows,
          ).toEqual(history);
          expect(
            (await selected.db.query('SELECT count(*) FROM publication_schedules')).rows[0].count,
          ).toBe('1');
          expect(
            (await selected.db.query('SELECT count(*) FROM content_releases')).rows[0].count,
          ).toBe('1');
          expect(
            (await selected.db.query('SELECT object_key FROM assets')).rows[0].object_key,
          ).toBe(`${id}/original.png`);
          const published = await selected.store.publishedStories(tokens[index], id, {});
          expect(published.stories).toHaveLength(1);
          expect(JSON.stringify(published)).not.toContain('Unfinished draft');
          expect(
            JSON.stringify((await selected.db.query('SELECT fields FROM block_drafts')).rows),
          ).toContain('Unfinished draft');
          await expect(
            selected.store.publishedStories(tokens[1 - index], id, {}),
          ).rejects.toThrow();
        } finally {
          await selected.close();
        }
        // Rollback is the retained source and old application: published tokens still work there.
        expect((await store.publishedStories(tokens[index], id, {})).stories).toHaveLength(1);
      }
      expect((await source.query('SELECT count(*) FROM spaces')).rows[0].count).toBe('2');
      if (process.env.STORYPANE_VERIFY_EXAMPLES)
        await verifyMigratedExamples({
          connectionString: urls[1],
          encryptionKey: installation.options.encryptionKey,
          spaceId: ids[0],
          deliveryToken: tokens[0],
        });
    } finally {
      await installation?.pool.end();
      await Promise.all(pools.map((pool) => pool.end()));
      for (const name of names.reverse()) {
        await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        await admin.query(`DROP ROLE IF EXISTS "${name}"`);
      }
      await admin.end();
    }
  },
  120000,
);
