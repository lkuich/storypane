import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expect, it } from 'vitest';

// An operator supplies a signed-in disposable installation, never a production cookie.
const fixture = process.env.STORYPANE_MANAGEMENT_TEST_SESSION;
it.skipIf(!fixture)(
  'API, CLI and MCP share live authorization, writes, space isolation and revocation',
  async () => {
    const { base, cookie, spaces } = JSON.parse(await readFile(fixture!, 'utf8'));
    const ready = spaces.filter(
      (s: { provisioningStatus: string }) => s.provisioningStatus === 'ready',
    );
    expect(ready.length).toBeGreaterThanOrEqual(2);
    const space = ready[0].id;
    const cms = (path: string, method: string, body?: unknown) =>
      fetch(base + '/api/cms/' + path, {
        method,
        headers: {
          cookie,
          origin: base,
          'content-type': 'application/json',
          'x-storypane-space-id': space,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const tokens: Array<{ id: string; token: string }> = [];
    const clients: Client[] = [];
    const bin = fileURLToPath(new URL('../bin/storypane.mjs', import.meta.url));
    async function mcp(token: string) {
      const client = new Client({ name: 'live-test', version: '1' });
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [bin, 'mcp'],
          env: {
            STORYPANE_URL: base,
            STORYPANE_SPACE_ID: space,
            STORYPANE_MANAGEMENT_TOKEN: token,
          },
          stderr: 'pipe',
        }),
      );
      clients.push(client);
      return client;
    }
    let folder: string | undefined;
    try {
      for (const scopes of [['read'], ['read', 'content:edit']]) {
        const response = await cms('management-tokens', 'POST', {
          name: 'Temporary interface acceptance',
          scopes,
        });
        expect(response.status).toBe(201);
        tokens.push(await response.json());
      }
      const reader = await mcp(tokens[0].token),
        writer = await mcp(tokens[1].token);
      const read = await reader.callTool({
        name: 'storypane_read',
        arguments: { path: '/stories' },
      });
      expect(read.isError).not.toBe(true);
      const denied = await reader.callTool({
        name: 'storypane_write',
        arguments: { method: 'POST', path: '/folders', body: { name: 'Denied', slug: 'denied' } },
      });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied)).toContain('403');
      const created = await writer.callTool({
        name: 'storypane_write',
        arguments: {
          method: 'POST',
          path: '/folders',
          body: { name: 'MCP acceptance', slug: 'mcp-' + randomUUID() },
        },
      });
      expect(created.isError).not.toBe(true);
      folder = JSON.parse((created.content as Array<{ text: string }>)[0].text).id;
      expect(folder).toBeTruthy();
      const cli = await promisify(execFile)(process.execPath, [bin, 'folders', 'list', '--json'], {
        env: {
          ...process.env,
          STORYPANE_URL: base,
          STORYPANE_SPACE_ID: space,
          STORYPANE_MANAGEMENT_TOKEN: tokens[0].token,
        },
      });
      expect(JSON.parse(cli.stdout).items.some((f: { id: string }) => f.id === folder)).toBe(true);
      const wrongSpace = await fetch(`${base}/api/management/v1/spaces/${ready[1].id}/stories`, {
        headers: { authorization: `Bearer ${tokens[0].token}` },
      });
      expect(wrongSpace.status).toBe(401);
      expect((await cms('management-tokens/' + tokens[0].id, 'DELETE')).ok).toBe(true);
      const revoked = await reader.callTool({
        name: 'storypane_read',
        arguments: { path: '/stories' },
      });
      expect(revoked.isError).toBe(true);
      expect(JSON.stringify(revoked)).toContain('401');
      const deleted = await writer.callTool({
        name: 'storypane_write',
        arguments: { method: 'DELETE', path: '/folders/' + folder },
      });
      expect(deleted.isError).not.toBe(true);
      folder = undefined;
    } finally {
      if (folder) await cms('folders/' + folder, 'DELETE');
      for (const token of tokens) await cms('management-tokens/' + token.id, 'DELETE');
      await Promise.all(clients.map((c) => c.close()));
    }
  },
  30000,
);
