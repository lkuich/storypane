import { BlokError } from '@blok/core'

export function assertOrigin(request: Request, appURL: string) {
  if (request.headers.get('origin') !== new URL(appURL).origin) {
    throw new BlokError('forbidden', 'This request must come from the editor.')
  }
}

export async function readJson(request: Request): Promise<unknown> {
  const limit = 2 * 1024 * 1024
  if (!request.headers.get('content-type')?.includes('application/json')) throw new BlokError('invalid', 'Expected JSON')
  if (!request.body) throw new BlokError('invalid', 'Missing request body')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) { await reader.cancel(); throw new BlokError('invalid', 'Request exceeds 2 MiB') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder().decode(body)) } catch { throw new BlokError('invalid', 'Malformed JSON') }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof BlokError) {
    const statuses = { unauthenticated: 401, forbidden: 403, not_found: 404, locked: 423, stale_revision: 409, invalid: 400, unavailable: 503 }
    return Response.json({ error: { code: error.code, message: error.message, details: error.details } }, { status: statuses[error.code], headers: { 'Cache-Control': 'no-store' } })
  }
  console.error('CMS request failed', error)
  return Response.json({ error: { code: 'unavailable', message: 'The request could not be completed. Please retry.' } }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
}

export function jsonResponse(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}
