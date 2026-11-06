import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expect, it } from 'vitest';

it('serves MCP over stdio with fixed credentials, scoped paths and API errors', async () => {
  const requests: Array<{ path: string; method: string; token?: string }> = [];
  const http = createServer((req, res) => {
    requests.push({ path: req.url!, method: req.method!, token: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    if (req.method !== 'GET') {
      res
        .writeHead(403)
        .end(JSON.stringify({ error: { message: 'Read only', code: 'forbidden' } }));
    } else res.end(JSON.stringify({ items: [{ id: 'story' }], nextOffset: null }));
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address() as { port: number };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../bin/storypane.mjs', import.meta.url)), 'mcp'],
    env: {
      STORYPANE_URL: `http://127.0.0.1:${address.port}`,
      STORYPANE_SPACE_ID: 'space-a',
      STORYPANE_MANAGEMENT_TOKEN: 'private-token',
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'storypane-test', version: '1' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(['storypane_read', 'storypane_write']);
    expect(tools.tools[0].annotations?.readOnlyHint).toBe(true);
    const read = await client.callTool({
      name: 'storypane_read',
      arguments: { path: '/stories?limit=2' },
    });
    expect(JSON.stringify(read)).toContain('story');
    expect(requests).toEqual([
      {
        path: '/api/management/v1/spaces/space-a/stories?limit=2',
        method: 'GET',
        token: 'Bearer private-token',
      },
    ]);
    const denied = await client.callTool({
      name: 'storypane_write',
      arguments: { path: '/folders', method: 'POST', body: { name: 'Example' } },
    });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).toContain('forbidden');
    const count = requests.length;
    for (const path of [
      '/../../spaces/other/stories',
      '//other.test/',
      '/%2e%2e/%2e%2e/spaces/other/stories',
      '/stories#fragment',
    ]) {
      const invalid = await client.callTool({ name: 'storypane_read', arguments: { path } });
      expect(invalid.isError).toBe(true);
      expect(JSON.stringify(invalid)).not.toContain('private-token');
    }
    expect(requests).toHaveLength(count);
  } finally {
    await client.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
}, 15000);
