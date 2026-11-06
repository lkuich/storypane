import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const eslint = new ESLint({ cwd: new URL('../', import.meta.url).pathname });

it('checks TypeScript, React hooks, Astro templates, CLI JavaScript and Next.js pages', async () => {
  const probes = [
    [
      'apps/web/src/features/editor/use-story-editor.ts',
      "import { useState } from 'react'; export function useExample(flag:boolean) { if(flag) useState(0); }",
      'react-hooks/rules-of-hooks',
    ],
    ['apps/realtime/src/room.ts', 'const unused = 1;', '@typescript-eslint/no-unused-vars'],
    ['packages/core/src/index.ts', 'const unused = 1;', '@typescript-eslint/no-unused-vars'],
    ['scripts/setup.ts', 'const unused = 1;', '@typescript-eslint/no-unused-vars'],
    ['tests/auth.ts', 'const unused = 1;', '@typescript-eslint/no-unused-vars'],
    ['packages/sdk/bin/storypane.mjs', 'missingFunction();', 'no-undef'],
    [
      'apps/example-astro/src/components/blocks/hero.tsx',
      'const unused = 1;',
      '@typescript-eslint/no-unused-vars',
    ],
    [
      'apps/example-astro/src/pages/preview.astro',
      '<div set:html="hello">conflicting content</div>',
      'astro/no-conflict-set-directives',
    ],
    [
      'apps/example-next/src/app/page.tsx',
      "'use client'; export default async function Page() { return null; }",
      '@next/next/no-async-client-component',
    ],
  ];
  for (const [filePath, code, rule] of probes) {
    const [result] = await eslint.lintText(code!, { filePath: filePath! });
    expect(
      result?.messages.map((message) => message.ruleId),
      filePath,
    ).toContain(rule);
  }
});

it('excludes generated output without excluding either example’s source', async () => {
  for (const path of [
    'apps/example-next/.next/server/app/page.js',
    'apps/web/dist/server/index.js',
    'apps/example-astro/dist/index.html',
    'apps/example-astro/src/types/storypane.ts',
    'apps/example-next/src/types/storypane.ts',
  ]) {
    expect(await eslint.isPathIgnored(path), path).toBe(true);
  }
  for (const path of [
    'apps/example-next/src/lib/storypane.ts',
    'apps/example-astro/src/lib/cms.ts',
    'apps/web/src/env.d.ts',
  ]) {
    expect(await eslint.isPathIgnored(path), path).toBe(false);
  }
});
