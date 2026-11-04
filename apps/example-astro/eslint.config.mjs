import js from '@eslint/js';
import ts from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  { ignores:['dist/**','.astro/**','src/types/storypane.ts'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...astro.configs.recommended,
  { languageOptions:{ globals:{ ...globals.browser,...globals.node } } },
  { files:['**/*.astro'],languageOptions:{ parserOptions:{ parser:ts.parser } } },
  { files:['**/*.tsx'],plugins:{ 'react-hooks':hooks },rules:{ 'react-hooks/rules-of-hooks':'error','react-hooks/exhaustive-deps':'error' } },
];
