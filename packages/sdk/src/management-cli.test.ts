import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { runManagement } = await import(new URL('../bin/manage.mjs', import.meta.url).href);
const setting = (name: string) =>
  ({ URL: 'https://cms.test', SPACE_ID: 'space', MANAGEMENT_TOKEN: 'secret' })[name];
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('management CLI', () => {
  it('requires confirmation for destructive writes and rejects unsupported actions and flags before fetching', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(runManagement(['stories', 'delete', 'story'], {}, setting)).rejects.toThrow(
      '--yes',
    );
    await expect(runManagement(['api', 'POST', '/stories'], {}, setting)).rejects.toThrow('--yes');
    await expect(runManagement(['folders', 'get', 'folder'], {}, setting)).rejects.toThrow(
      'Supported actions',
    );
    await expect(
      runManagement(['stories', 'list'], { out: 'ignored.json' }, setting),
    ).rejects.toThrow('--out');
    await expect(
      runManagement(['content', 'get', 'story', 'locale', 'extra'], {}, setting),
    ).rejects.toThrow('block ID');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('forwards JSON file input and exact mutation IDs, and returns structured results', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storypane-cli-'));
    try {
      const file = join(directory, 'edit.json');
      await writeFile(
        file,
        JSON.stringify({
          fields: { title: 'Imported' },
          expectedRevision: 3,
          mutationId: 'retry-id',
        }),
      );
      const fetcher = vi.fn<typeof fetch>(async () =>
        Response.json({ checkpointId: 'checkpoint' }),
      );
      vi.stubGlobal('fetch', fetcher);
      expect(
        await runManagement(
          ['content', 'save', 'story', 'locale', 'block'],
          { input: file, json: true },
          setting,
        ),
      ).toEqual({ checkpointId: 'checkpoint' });
      expect(String(fetcher.mock.calls[0]![0])).toMatch(
        /stories\/story\/locales\/locale\/commands$/,
      );
      expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({
        mutationId: 'retry-id',
        expectedRevisions: { block: 3 },
        payload: { fields: { title: 'Imported' } },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('uses the story location route and native asset cursor pagination', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ items: [] }));
    vi.stubGlobal('fetch', fetcher);
    await runManagement(['assets', 'list'], { cursor: 'next page' }, setting);
    expect(String(fetcher.mock.calls[0]![0])).toMatch(/assets\?cursor=next\+page$/);
    const directory = await mkdtemp(join(tmpdir(), 'storypane-cli-'));
    try {
      const input = join(directory, 'location.json');
      await writeFile(input, '{}');
      await runManagement(['stories', 'update', 'story'], { input }, setting);
      expect(String(fetcher.mock.calls[1]![0])).toMatch(/stories\/story\/location$/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('streams downloads and preserves an existing file when a stream fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storypane-cli-'));
    const output = join(directory, 'asset');
    try {
      await writeFile(output, 'original');
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error('Disconnected'));
                },
              }),
            ),
        ),
      );
      await expect(
        runManagement(['assets', 'download', 'asset'], { out: output }, setting),
      ).rejects.toThrow('Disconnected');
      expect(await readFile(output, 'utf8')).toBe('original');
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('downloaded')),
      );
      expect(
        await runManagement(['assets', 'download', 'asset'], { out: output }, setting),
      ).toEqual({ file: output });
      expect(await readFile(output, 'utf8')).toBe('downloaded');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it('runs the CLI with JSON stdin and machine-readable success and failure output', async () => {
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { once } = (await import('node:events')).default;
  const server = createServer(async (request, response) => {
    let body = '';
    request.setEncoding('utf8');
    for await (const chunk of request) {
      body += chunk;
    }
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'POST') {
      response.end(JSON.stringify({ received: JSON.parse(body), path: request.url }));
    } else {
      response.statusCode = 403;
      response.end(JSON.stringify({ error: { code: 'forbidden', message: 'No access' } }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing test server');
  }
  async function run(args: string[], input?: string) {
    const child = spawn(
      process.execPath,
      [new URL('../bin/storypane.mjs', import.meta.url).pathname, ...args],
      {
        env: {
          ...process.env,
          STORYPANE_URL: `http://127.0.0.1:${(address as { port: number }).port}`,
          STORYPANE_SPACE_ID: 'space',
          STORYPANE_MANAGEMENT_TOKEN: 'test-token',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let stdout = '',
      stderr = '';
    child.stdout.setEncoding('utf8').on('data', (value) => {
      stdout += value;
    });
    child.stderr.setEncoding('utf8').on('data', (value) => {
      stderr += value;
    });
    if (input) {
      const bytes = Buffer.from(input);
      for (const byte of bytes) {
        child.stdin.write(Buffer.from([byte]));
      }
    }
    child.stdin.end();
    const [code] = await once(child, 'close');
    return { code, stdout, stderr };
  }
  try {
    const success = await run(
      ['api', 'POST', '/stories', '--input', '-', '--yes', '--json'],
      JSON.stringify({ name: '你好 — forêt' }),
    );
    expect(success.code).toBe(0);
    expect(JSON.parse(success.stdout)).toEqual({
      received: { name: '你好 — forêt' },
      path: '/api/management/v1/spaces/space/stories',
    });
    expect(success.stderr).toBe('');
    const failure = await run(['stories', 'list', '--json']);
    expect(failure.code).toBe(1);
    expect(failure.stdout).toBe('');
    expect(JSON.parse(failure.stderr)).toEqual({
      error: { code: 'forbidden', message: 'No access', status: 403 },
    });
  } finally {
    server.close();
  }
});
