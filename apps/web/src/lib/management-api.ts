import { StorypaneError } from '@storypane/core';
import { errorResponse, jsonResponse } from './http';

const resources = new Set([
  'space',
  'stories',
  'releases',
  'folders',
  'locales',
  'definitions',
  'datasources',
  'options',
  'assets',
  'migrations',
  'delivery-settings',
  'delivery-tokens',
  'public-media',
  'roles',
  'members',
  'invitations',
  'webhooks',
]);
type Handler = (
  request: Request,
  route: { params: Promise<{ path: string[] }> },
) => Promise<Response>;

export async function managementRequest(
  request: Request,
  path: string[],
  handle: Handler,
): Promise<Response> {
  try {
    if (!/^Bearer sm_[\w-]{43}$/.test(request.headers.get('authorization') ?? '')) {
      throw new StorypaneError('unauthenticated', 'A management bearer token is required');
    }
    const [prefix, spaceId, resource, ...rest] = path;
    if (
      prefix !== 'spaces' ||
      !spaceId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(spaceId) ||
      !resources.has(resource)
    ) {
      throw new StorypaneError('not_found', 'Use /api/management/v1/spaces/{spaceId}/{resource}');
    }
    const url = new URL(request.url);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 100);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1000
    ) {
      throw new StorypaneError(
        'invalid',
        'Use an offset of 0 or more and a limit between 1 and 1000',
      );
    }
    const headers = new Headers(request.headers);
    headers.set('x-storypane-space-id', spaceId);
    headers.delete('cookie');
    // vinext's request wrapper is not always an instance of the runtime's Request.
    const init = {
      method: request.method,
      headers,
      body: request.body,
      duplex: 'half' as const,
    };
    const forwarded = await handle(new Request(request.url, init), {
      params: Promise.resolve({ path: [resource, ...rest] }),
    });
    const response = new Response(forwarded.body, forwarded);
    response.headers.set('Cache-Control', 'no-store');
    if (
      request.method !== 'GET' ||
      !response.ok ||
      !response.headers.get('content-type')?.includes('application/json')
    ) {
      return response;
    }
    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      return jsonResponse(body, response.status);
    }
    // shortcut: existing store list methods load all permitted rows; push paging into SQL for large spaces.
    return jsonResponse({
      items: body.slice(offset, offset + limit),
      total: body.length,
      nextOffset: offset + limit < body.length ? offset + limit : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
