import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  output: 'static',
  integrations: [react()],
  redirects: { '/': '/home' },
  devToolbar: { enabled: false },
});
