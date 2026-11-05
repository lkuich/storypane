export { env } from 'cloudflare:workers';
export const openCache = (name: string) => caches.open(name);
