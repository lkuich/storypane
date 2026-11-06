import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
it('rejects unsupported Cloudflare deployment before reading credentials or invoking cf', () => {
  for (const args of [[], ['--check']]) {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        createRequire(import.meta.url).resolve('tsx'),
        'scripts/deploy-cloudflare.ts',
        ...args,
      ],
      { encoding: 'utf8', env: { PATH: process.env.PATH, NODE_ENV: 'test' } },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Node/Docker');
    expect(result.stderr).toContain('previous supported release');
  }
});
