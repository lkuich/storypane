import { StorypaneError } from '@storypane/core'
import { env } from 'cloudflare:workers'
import { handleAssets } from '@storypane/assets'
import { createServices } from '../../../../lib/context'
import { errorResponse, jsonResponse, readJson } from '../../../../lib/http'

function cors(response: Response): Response {
  response.headers.set('Access-Control-Allow-Origin', '*')
  response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  return response
}
export function OPTIONS() { return cors(new Response(null, { status:204 })) }
async function handle(request: Request, route: { params:Promise<{ resource:string }> }) {
  const services = createServices()
  try {
    const { resource } = await route.params
    const url = new URL(request.url), token = request.headers.get('authorization')?.replace(/^Bearer /i, '') ?? ''
    const spaceId = url.searchParams.get('space') ?? ''
    if(resource==='assets' && ['GET','HEAD'].includes(request.method)) {
      const id=url.searchParams.get('id') ?? ''
      await services.store.authorizePublishedAsset(token,spaceId,id)
      return cors(await handleAssets(request,[id,'content'],{db:services.db,bucket:env.MEDIA,canWrite:false,actor:{spaceId,userId:'delivery',sessionId:'',role:'viewer'}}))
    }
    if (resource === 'locales' && request.method === 'GET') return cors(jsonResponse(await services.store.deliveryLocales(token, spaceId)))
    if (resource === 'schema' && request.method === 'GET') return cors(jsonResponse(await services.store.deliverySchema(token, spaceId)))
    if (resource === 'stories' && request.method === 'GET') {
      const result = await services.store.publishedStories(token, spaceId, {
        ...(url.searchParams.has('id') ? { id:url.searchParams.get('id') } : {}),
        ...(url.searchParams.has('slug') ? { slug:url.searchParams.get('slug') } : {}),
        locale:url.searchParams.get('locale') ?? '', offset:Number(url.searchParams.get('offset') ?? 0), limit:Number(url.searchParams.get('limit') ?? 50),
      })
      return cors(jsonResponse(result))
    }
    if (resource === 'preview' && request.method === 'POST') return cors(jsonResponse(await services.store.createTokenPreview(token, spaceId, await readJson(request)), 201))
    throw new StorypaneError('not_found', 'Delivery endpoint not found')
  } catch (error) { return cors(errorResponse(error)) }
  finally { await services.db.end() }
}
export { handle as GET, handle as HEAD, handle as POST }
