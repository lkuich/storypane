import { DurableObject } from 'cloudflare:workers'
import { BlokError, type Actor, type CommitResult, type LocaleSnapshot } from '@blok/core'
import { BlokStore } from '@blok/db'

export interface Env { HYPERDRIVE: { connectionString: string } }
type Connection = { actor: Actor; storyId: string; localeId: string; previewSessionId?:string }
const cleanSnapshot = (snapshot: LocaleSnapshot): LocaleSnapshot => ({ ...snapshot, leases: snapshot.leases.map(({ token: _token, ...lease }) => lease) })
const errorMessage = (error: unknown) => error instanceof BlokError ? { type: 'error', code: error.code, message: error.message, details: error.details } : { type: 'error', code: 'unavailable', message: 'The collaboration service is unavailable. Your unsent edits are preserved.' }

export class StoryRoom extends DurableObject<Env> {
  private async withStore<T>(run: (store: BlokStore) => Promise<T>): Promise<T> {
    const store = new BlokStore(this.env.HYPERDRIVE.connectionString)
    try { return await run(store) } finally { await store.pool.end() }
  }
  private connection(request: Request): Connection {
    let actor: Actor
    try { actor = JSON.parse(request.headers.get('x-blok-actor') ?? '') as Actor } catch { throw new BlokError('unauthenticated', 'Authentication is required') }
    const storyId = request.headers.get('x-blok-story-id')
    const localeId = request.headers.get('x-blok-locale-id')
    if (!actor.userId || !actor.sessionId || !actor.spaceId || !storyId || !localeId) throw new BlokError('unauthenticated', 'Authentication is required')
    return { actor, storyId, localeId, ...(request.headers.get('x-blok-preview-id') ? { previewSessionId:request.headers.get('x-blok-preview-id')! } : {}) }
  }
  private send(socket: WebSocket, message: unknown): void { try { socket.send(JSON.stringify(message)) } catch { /* A disconnected client recovers committed state on reconnect. */ } }
  private async broadcast(connection: Connection, message: unknown): Promise<void> {
    await this.withStore(async store => {
      await Promise.all(this.ctx.getWebSockets().map(async socket => {
        const current = socket.deserializeAttachment() as Connection | undefined
        if (current?.actor.spaceId !== connection.actor.spaceId || current.storyId !== connection.storyId || current.localeId !== connection.localeId) return
        try {
          if (current.previewSessionId) {
            const story = await store.previewStory(current.previewSessionId)
            if ((message as { type?:string }).type === 'commit') this.send(socket, { type:'content', story })
          } else { await store.assertActor(current.actor); this.send(socket, message) }
        }
        catch (error) { this.send(socket, errorMessage(error)); if (error instanceof BlokError && ['unauthenticated', 'forbidden'].includes(error.code)) socket.close(1008, 'Authentication expired') }
      }))
    })
  }
  private async presence(connection: Connection): Promise<void> {
    const editors = new Map<string, { userId: string; sessionId: string }>()
    for (const socket of this.ctx.getWebSockets()) {
      const current = socket.deserializeAttachment() as Connection | undefined
      if (!current?.previewSessionId && current?.actor.spaceId === connection.actor.spaceId && current.storyId === connection.storyId && current.localeId === connection.localeId) editors.set(current.actor.sessionId, { userId: current.actor.userId, sessionId: current.actor.sessionId })
    }
    await this.broadcast(connection, { type: 'presence', editors: [...editors.values()] })
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const connection = this.connection(request)
      const url = new URL(request.url)
      if (url.pathname === '/preview-live' && connection.previewSessionId && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
        const story = await this.withStore(store => store.previewStory(connection.previewSessionId!))
        if (story.id !== connection.storyId || story.localeId !== connection.localeId) throw new BlokError('forbidden', 'Preview scope mismatch')
        const pair = new WebSocketPair()
        this.ctx.acceptWebSocket(pair[1]); pair[1].serializeAttachment(connection)
        this.send(pair[1], { type:'content', story })
        return new Response(null, { status:101, webSocket:pair[0], headers:{ 'Sec-WebSocket-Protocol':'blok-preview' } })
      }
      if (url.pathname === '/live' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
        const snapshot = await this.withStore(store => store.getSnapshot(connection.actor, connection.storyId, connection.localeId))
        const pair = new WebSocketPair()
        this.ctx.acceptWebSocket(pair[1])
        pair[1].serializeAttachment(connection)
        this.send(pair[1], { type: 'snapshot', snapshot })
        await this.presence(connection)
        return new Response(null, { status: 101, webSocket: pair[0] })
      }
      if (url.pathname === '/notify' && request.method === 'POST') {
        const snapshot = await this.withStore(store => store.getSnapshot(connection.actor, connection.storyId, connection.localeId))
        const body = await request.json() as CommitResult | { type: 'leases' }
        if ('type' in body && body.type === 'leases') await this.broadcast(connection, { type: 'heartbeat', revision: snapshot.revision, checkpointId: snapshot.checkpointId, leases: cleanSnapshot(snapshot).leases })
        else {
          const result = body as CommitResult
          if (!result.snapshot || result.snapshot.locale.id !== connection.localeId || result.snapshot.story.id !== connection.storyId || typeof result.localeRevision !== 'number') throw new BlokError('invalid', 'Invalid commit notification')
          await this.broadcast(connection, { type: 'commit', ...result, snapshot: cleanSnapshot(result.snapshot) })
        }
        return Response.json({ ok: true })
      }
      return new Response('Not found', { status: 404 })
    } catch (error) {
      const body = errorMessage(error)
      const status = body.code === 'unauthenticated' ? 401 : body.code === 'forbidden' ? 403 : body.code === 'invalid' ? 400 : 503
      return Response.json(body, { status })
    }
  }
  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const connection = socket.deserializeAttachment() as Connection
    try {
      if (typeof raw !== 'string' || raw.length > 4096) throw new BlokError('invalid', 'Invalid collaboration message')
      const message = JSON.parse(raw) as { type: string; revision?: number }
      if (!['heartbeat', 'sync'].includes(message.type)) throw new BlokError('invalid', 'Unsupported collaboration message')
      if (connection.previewSessionId) {
        const story = await this.withStore(store => store.previewStory(connection.previewSessionId!))
        this.send(socket, message.type === 'sync' || message.revision !== story.revision ? { type:'content', story } : { type:'heartbeat', revision:story.revision })
        return
      }
      const snapshot = await this.withStore(store => store.getSnapshot(connection.actor, connection.storyId, connection.localeId))
      if (message.type === 'sync' || message.revision !== snapshot.revision) this.send(socket, { type: 'snapshot', snapshot })
      else this.send(socket, { type: 'heartbeat', revision: snapshot.revision, checkpointId: snapshot.checkpointId, leases: snapshot.leases })
    } catch (error) {
      this.send(socket, errorMessage(error))
      if (error instanceof BlokError && (error.code === 'unauthenticated' || error.code === 'forbidden')) socket.close(1008, 'Authentication expired')
    }
  }
  async webSocketClose(socket: WebSocket): Promise<void> {
    const connection = socket.deserializeAttachment() as Connection | undefined
    if (connection && !connection.previewSessionId) await this.presence(connection)
  }
  async webSocketError(socket: WebSocket): Promise<void> { socket.close(1011, 'Reconnect to resume') }
}

// Rooms are reached only through the application's authenticated service binding.
export default { fetch() { return new Response('Not found', { status: 404 }) } } satisfies ExportedHandler<Env>
