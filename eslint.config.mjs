import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import hooks from 'eslint-plugin-react-hooks';
import next from '@next/eslint-plugin-next';
import globals from 'globals';

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    '**/.astro/**',
    '**/.cloudflare/**',
    '**/.wrangler/**',
    '**/.vinext/**',
    '**/.cache/**',
    '**/coverage/**',
    '**/test-results/**',
    '**/playwright-report/**',
    '**/next-env.d.ts',
    'apps/example-astro/src/types/storypane.ts',
    'apps/example-next/src/types/storypane.ts',
  ]),
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,astro}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx,mts,cts,astro}'],
    extends: [ts.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  ...astro.configs.recommended,
  { files: ['**/*.astro'], languageOptions: { parserOptions: { parser: ts.parser } } },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' },
  },
  {
    files: ['apps/example-next/**/*.{js,jsx,mjs,ts,tsx}'],
    plugins: { '@next/next': next },
    settings: { next: { rootDir: new URL('./apps/example-next/', import.meta.url).pathname } },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
      curly: ['error', 'all'],
    },
  },
]);
