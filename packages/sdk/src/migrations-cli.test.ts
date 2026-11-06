import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const cli = await import(new URL('../bin/migrations.mjs', import.meta.url).href);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'storypane-migrations-'));
  directories.push(dir);
  const base = {
    id: randomUUID(),
    spaceId: randomUUID(),
    version: 1,
    baseVersion: 0,
    name: 'Initial',
    status: 'deployed',
    revision: 1,
    definitions: [
      {
        id: randomUUID(),
        versionId: randomUUID(),
        version: 1,
        createdAt: '2026-01-01',
        name: 'page',
        displayName: 'Page',
        kind: 'content-type',
        fields: [
          { id: randomUUID(), name: 'title', label: 'Title', type: 'text', format: 'singleline' },
        ],
      },
    ],
  };
  const remote: (typeof base)[] = [base];
  const request = vi.fn(async (path = '', body?: unknown) => {
    if (!path && !body) return structuredClone(remote);
    if (!path) {
      const input = body as Pick<typeof base, 'id' | 'version' | 'baseVersion' | 'name'> & {
        definitions: {
          id: (typeof base.definitions)[number]['id'];
          schema: Omit<
            (typeof base.definitions)[number],
            'id' | 'versionId' | 'version' | 'createdAt'
          >;
        }[];
      };
      const active = {
        ...base,
        id: input.id,
        version: input.version,
        baseVersion: input.baseVersion,
        name: input.name,
        status: 'active',
        revision: 2,
        definitions: input.definitions.map((item) => ({
          ...item.schema,
          id: item.id,
          versionId: randomUUID(),
          version: 2,
          createdAt: '2026-01-02',
        })),
      };
      remote.splice(1, remote.length - 1, active);
      return structuredClone(active);
    }
    if (path.endsWith('/review'))
      return {
        migration: remote[1],
        token: 'review-token',
        blockers: [],
        changes: [],
        impacts: [],
      };
    if (path.endsWith('/deploy')) {
      expect(body).toHaveProperty('reviewToken', 'review-token');
      remote[1].status = 'deployed';
      return structuredClone(remote[1]);
    }
    throw new Error('Unexpected request');
  });
  await cli.pullMigrations(request, dir);
  return { dir, base, remote, request };
}
it('round trips library organization in v2 migration files while keeping delivery schemas unchanged', async () => {
  const { base } = await fixture();
  const child = {
    ...base.definitions[0],
    id: randomUUID(),
    name: 'child',
    parentDefinitionId: base.definitions[0].id,
  };
  const file = cli.migrationFile({ ...base, definitions: [...base.definitions, child] });
  expect(file.formatVersion).toBe(2);
  expect(file.definitions[1].parentDefinitionId).toBe(base.definitions[0].id);
  expect(cli.validateMigration(JSON.parse(JSON.stringify(file)))).toEqual(file);
  expect(file.definitions[1].schema).not.toHaveProperty('parentDefinitionId');
  expect(cli.schemaFromMigration(file).components[1]).not.toHaveProperty('parentDefinitionId');
});
it('creates, deploys noninteractively, archives, and generates only the deployed schema', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const { dir, request } = await fixture();
  await cli.createMigration('Rename title', dir);
  const active = JSON.parse(await readFile(join(dir, 'active.json'), 'utf8'));
  active.definitions[0].schema.fields[0].name = 'headline';
  await writeFile(join(dir, 'active.json'), JSON.stringify(active));
  expect(() => cli.schemaFromMigration(active)).toThrow('deployed migration');
  await cli.pushMigration(request, { dir, deploy: true, yes: true });
  expect(
    JSON.parse(await readFile(join(dir, '2.json'), 'utf8')).definitions[0].schema.fields[0].name,
  ).toBe('headline');
  await expect(readFile(join(dir, 'active.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  const local = await cli.localMigrations(dir);
  expect(cli.schemaFromMigration(local.deployed.at(-1))).toMatchObject({ migrationVersion: 2 });
});
it('preserves dirty files on conflicting pulls and refuses modified deployed history', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const { dir, request, remote } = await fixture();
  await cli.createMigration('Shared edit', dir);
  await cli.pushMigration(request, { dir });
  const path = join(dir, 'active.json'),
    active = JSON.parse(await readFile(path, 'utf8'));
  active.name = 'My unsaved change';
  await writeFile(path, JSON.stringify(active));
  remote[1].name = 'Another contributor';
  remote[1].revision++;
  await expect(cli.pullMigrations(request, dir)).rejects.toThrow('diverged');
  expect(JSON.parse(await readFile(path, 'utf8')).name).toBe('My unsaved change');
  const deployed = JSON.parse(await readFile(join(dir, '1.json'), 'utf8'));
  deployed.name = 'Edited history';
  await writeFile(join(dir, '1.json'), JSON.stringify(deployed));
  await expect(cli.localMigrations(dir)).rejects.toThrow('history is modified');
});
it('passes explicit CI data-loss acceptance after printing the reviewed impact', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const { dir, request } = await fixture();
  await cli.createMigration('Remove a field', dir);
  const reviewed = async (path = '', body?: unknown) => {
    const result = await request(path, body);
    return path.endsWith('/review') ? { ...result, confirmation: 'DEPLOY 2' } : result;
  };
  await cli.pushMigration(reviewed, { dir, deploy: true, yes: true });
  expect(request).toHaveBeenCalledWith(expect.stringContaining('/deploy'), {
    reviewToken: 'review-token',
    confirmation: 'DEPLOY 2',
  });
  expect(log).toHaveBeenCalledWith(expect.stringContaining('WARNING:'));
});
it('retains local edits when the remote workspace is unchanged and refuses duplicate create', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const { dir, request } = await fixture();
  await cli.createMigration('Active', dir);
  await cli.pushMigration(request, { dir });
  const path = join(dir, 'active.json'),
    active = JSON.parse(await readFile(path, 'utf8'));
  active.definitions[0].schema.fields[0].label = 'Local label';
  await writeFile(path, JSON.stringify(active));
  await cli.pullMigrations(request, dir);
  expect(JSON.parse(await readFile(path, 'utf8')).definitions[0].schema.fields[0].label).toBe(
    'Local label',
  );
  await expect(cli.createMigration('Replacement', dir)).rejects.toThrow('already exists');
});
it('does not deploy changes made by another contributor after the push', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const { dir, request, remote } = await fixture();
  await cli.createMigration('Reviewed commit', dir);
  const concurrent = async (path = '', body?: unknown) => {
    if (path.endsWith('/review')) {
      remote[1].name = 'Another change';
      remote[1].revision++;
    }
    return request(path, body);
  };
  await expect(cli.pushMigration(concurrent, { dir, deploy: true, yes: true })).rejects.toThrow(
    'changed after pushing',
  );
  expect(remote[1].status).toBe('active');
});
it('preserves local edits made while a push is in flight', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const { dir, request, remote } = await fixture();
  await cli.createMigration('Original', dir);
  const concurrent = async (path = '', body?: unknown) => {
    const result = await request(path, body);
    if (!path && body) {
      const file = JSON.parse(await readFile(join(dir, 'active.json'), 'utf8'));
      file.name = 'Edited during push';
      await writeFile(join(dir, 'active.json'), JSON.stringify(file));
    }
    return result;
  };
  await expect(cli.pushMigration(concurrent, { dir, deploy: true, yes: true })).rejects.toThrow(
    'local active file changed',
  );
  expect(JSON.parse(await readFile(join(dir, 'active.json'), 'utf8')).name).toBe(
    'Edited during push',
  );
  expect(remote[1].status).toBe('active');
});

it('resumes a reviewed promotion after a lost response using the same operation ID', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const { dir, base } = await fixture();
  vi.stubEnv('STORYPANE_PRODUCTION_MANAGEMENT_TOKEN', 'prod-secret');
  const review = {
    id: randomUUID(),
    token: 'a'.repeat(64),
    action: 'promote',
    sourceSpaceId: base.spaceId,
    targetSpaceId: randomUUID(),
    conflicts: [],
    resolutions: {},
    dependencies: { stories: [], assets: [], datasources: [] },
    steps: [],
    confirmation: null,
  };
  let calls = 0;
  const applied: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(new Headers(init?.headers).get('x-storypane-production-token')).toBe('prod-secret');
    if (String(url).endsWith('/transfer-review')) return Response.json(review);
    applied.push(JSON.parse(init!.body as string).id);
    if (++calls === 1) throw new Error('Lost response');
    return Response.json(review);
  });
  vi.stubGlobal('fetch', fetcher);
  const settings: Record<string, string> = {
    URL: 'https://cms.test',
    SPACE_ID: base.spaceId,
    MANAGEMENT_TOKEN: 'dev-secret',
  };
  await expect(
    cli.runEnvironmentMigration('promote', { yes: true }, (name: string) => settings[name], dir),
  ).rejects.toThrow('Lost response');
  expect(JSON.parse(await readFile(join(dir, '.transfer.json'), 'utf8')).review.id).toBe(review.id);
  await cli.runEnvironmentMigration(
    'promote',
    { yes: true },
    (name: string) => settings[name],
    dir,
  );
  expect(applied).toEqual([review.id, review.id]);
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).endsWith('/transfer-review')),
  ).toHaveLength(1);
  await expect(readFile(join(dir, '.transfer.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
