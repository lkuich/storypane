import { createServer } from 'node:http';
import { nodeToWebRequest, sendWebResponse } from 'vinext/server/prod-server';
import { GET as delivery, OPTIONS } from './app/api/delivery/[resource]/route';
import { GET as media } from './app/media/[spaceId]/[assetId]/[kind]/route';
import { GET as ready } from './app/api/ready/route';
import { errorResponse } from './lib/http';

async function handle(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const resource = pathname.match(/^\/api\/delivery\/(stories|locales|assets)$/)?.[1];
  const asset = pathname.match(/^\/media\/([^/]+)\/([^/]+)\/(original|image)$/);
  if (!resource && !asset && pathname !== '/api/ready')
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (resource && request.method === 'OPTIONS') return OPTIONS();
  if (!['GET', 'HEAD'].includes(request.method))
    return new Response(null, {
      status: 405,
      headers: {
        Allow: resource ? 'GET, HEAD, OPTIONS' : 'GET, HEAD',
        'Cache-Control': 'no-store',
      },
    });
  if (resource) {
    const read =
      request.method === 'HEAD' && resource !== 'assets'
        ? new Request(request, { method: 'GET' })
        : request;
    return delivery(read, { params: Promise.resolve({ resource }) });
  }
  if (asset) {
    const [, spaceId, assetId, kind] = asset;
    return media(request, { params: Promise.resolve({ spaceId, assetId, kind }) });
  }
  return ready();
}

/** Published delivery shares authorization with the CMS, without rooms or scheduled jobs. */
export function createDeliveryServer() {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const response = await handle(nodeToWebRequest(incoming));
      await sendWebResponse(response, incoming, outgoing, true);
    } catch (error) {
      if (outgoing.headersSent) outgoing.destroy();
      else await sendWebResponse(errorResponse(error), incoming, outgoing, false);
    }
  });
  server.on('upgrade', (_request, socket) => {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  });
  return server;
}
