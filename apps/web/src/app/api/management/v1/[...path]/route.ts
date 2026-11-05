import { GET as handleCMS } from '../../../cms/[...path]/route';
import { managementRequest } from '../../../../../lib/management-api';

async function handle(request: Request, route: { params: Promise<{ path: string[] }> }) {
  return managementRequest(request, (await route.params).path, handleCMS);
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
  handle as HEAD,
};
