import { env } from 'cloudflare:workers'
import { authenticateSession, createServices } from '../../../lib/context'
import { assertOrigin, errorResponse, jsonResponse, readJson } from '../../../lib/http'

async function handle(request: Request) {
  const services = createServices()
  try {
    const session = await authenticateSession(request, services)
    const actor = { userId: session.user.id, sessionId: session.session.id }
    if (request.method === 'GET') return jsonResponse(await services.store.listSpaces(actor))
    assertOrigin(request, env.APP_URL)
    return jsonResponse(await services.store.createSpace(actor, await readJson(request)), 201)
  } catch (error) { return errorResponse(error) }
  finally { await services.db.end() }
}

export { handle as GET, handle as POST }
