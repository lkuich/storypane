import { createServices } from '../../../../lib/context'
import { errorResponse } from '../../../../lib/http'

async function handle(request: Request) {
  const services = createServices()
  try { return await services.auth.handler(request) }
  catch (error) { return errorResponse(error) }
  finally { await services.db.end() }
}

export { handle as GET, handle as POST }
