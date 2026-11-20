import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixtures = new URL('./test-fixtures/', import.meta.url);

export default defineConfig({
  root: fileURLToPath(fixtures),
  publicDir: fileURLToPath(new URL('./public/', import.meta.url)),
  plugins: [react()],
  build: {
    // Match vinext's Safari target so the build lowers light-dark() in the fixtures too.
    cssTarget: 'safari15',
    rolldownOptions: {
      input: readdirSync(fixtures)
        .filter((file) => file.endsWith('.html'))
        .map((file) => fileURLToPath(new URL(file, fixtures))),
    },
  },
  preview: { host: '127.0.0.1', port: 3144, strictPort: true },
});
