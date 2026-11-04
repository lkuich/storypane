import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StorypaneError, type Actor, type LocaleSnapshot } from '@storypane/core'

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), assertActor: vi.fn(), preview:vi.fn(), end: vi.fn() }))
vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }))
vi.mock('@storypane/db', () => ({ StorypaneStore: class { pool = { end: mocks.end }; getSnapshot = mocks.snapshot; assertActor = mocks.assertActor; previewStory = mocks.preview } }))
import { StoryRoom } from './index.js'

const actor: Actor = { userId: 'alice', sessionId: 'session', spaceId: 'space', role: 'editor' }
const connection = { actor, storyId: 'story', localeId: 'locale' }
const snapshot = { story: { id: 'story' }, locale: { id: 'locale' }, revision: 7, checkpointId: 'checkpoint', blocks: [], definitions: [], leases: [{ blockId: 'hero', userId: 'alice', sessionId: 'session', token: 'secret-lease', expiresAt: 'later' }] } as unknown as LocaleSnapshot
function fixture(preview = false) {
  const socket = { send: vi.fn(), close: vi.fn(), deserializeAttachment: () => ({ ...connection, ...(preview ? { previewSessionId:'preview' } : {}) }) }
  const ctx = { getWebSockets: () => [socket] }
  const room = new StoryRoom(ctx as never, { HYPERDRIVE: { connectionString: 'unused' } })
  return { socket, room }
}
beforeEach(() => { vi.clearAllMocks(); mocks.snapshot.mockResolvedValue(snapshot); mocks.assertActor.mockResolvedValue(undefined); mocks.end.mockResolvedValue(undefined) })
describe('realtime recovery and authorization', () => {
  it('refreshes referenced drafts even when the parent story revision is unchanged',async()=>{
    const story={id:'story',localeId:'locale',revision:7,referencesRevision:'footer-v2',references:[{id:'footer',content:{text:'Updated footer'}}]}
    mocks.preview.mockResolvedValue(story)
    const {socket,room}=fixture(true)
    await room.webSocketMessage(socket as never,JSON.stringify({type:'heartbeat',revision:7,referencesRevision:'footer-v1'}))
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({type:'content',story})
    await room.webSocketMessage(socket as never,JSON.stringify({type:'heartbeat',revision:7,referencesRevision:'footer-v2'}))
    expect(JSON.parse(socket.send.mock.calls[1][0])).toEqual({type:'heartbeat',revision:7})
    mocks.preview.mockResolvedValue({...story,referencesRevision:'empty',references:[]})
    await room.webSocketMessage(socket as never,JSON.stringify({type:'heartbeat',revision:7,referencesRevision:'footer-v2'}))
    expect(JSON.parse(socket.send.mock.calls[2][0]).story.references).toEqual([])
  })
  it('streams content-only preview snapshots and refuses editing commands', async () => {
    const story = { id:'story',localeId:'locale',revision:7,content:{ title:'Draft' } }
    mocks.preview.mockResolvedValue(story)
    const { socket,room } = fixture(true)
    await room.webSocketMessage(socket as never,JSON.stringify({ type:'sync' }))
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ type:'content',story })
    expect(mocks.snapshot).not.toHaveBeenCalled()
    await room.webSocketMessage(socket as never,JSON.stringify({ type:'saveBlock' }))
    expect(JSON.parse(socket.send.mock.calls[1][0])).toMatchObject({ type:'error',code:'invalid' })
    mocks.preview.mockRejectedValue(new StorypaneError('unauthenticated','Revoked'))
    await room.webSocketMessage(socket as never,JSON.stringify({ type:'heartbeat' }))
    expect(socket.close).toHaveBeenCalledWith(1008,'Authentication expired')
  })
  it('resends current persisted snapshot on heartbeat revision gaps, including after restart', async () => {
    const { socket, room } = fixture()
    await room.webSocketMessage(socket as never, JSON.stringify({ type: 'heartbeat', revision: 6 }))
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ type: 'snapshot', snapshot })
    const restarted = fixture()
    await restarted.room.webSocketMessage(restarted.socket as never, JSON.stringify({ type: 'sync' }))
    expect(mocks.snapshot).toHaveBeenCalledWith(actor, 'story', 'locale')
    expect(JSON.parse(restarted.socket.send.mock.calls[0][0]).snapshot.revision).toBe(7)
  })
  it('does not report saved state when Postgres is unavailable', async () => {
    mocks.snapshot.mockRejectedValue(new Error('database down'))
    const { socket, room } = fixture()
    await room.webSocketMessage(socket as never, JSON.stringify({ type: 'heartbeat', revision: 7 }))
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ type: 'error', code: 'unavailable' })
  })
  it('rejects expired sessions and closes their socket', async () => {
    mocks.snapshot.mockRejectedValue(new StorypaneError('unauthenticated', 'Expired'))
    const { socket, room } = fixture()
    await room.webSocketMessage(socket as never, JSON.stringify({ type: 'sync' }))
    expect(socket.close).toHaveBeenCalledWith(1008, 'Authentication expired')
  })
  it('strips lease secrets from committed broadcasts', async () => {
    const { socket, room } = fixture()
    const result = { mutationId: 'mutation', localeRevision: 7, changedBlockIds: ['hero'], checkpointId: 'checkpoint', snapshot }
    const response = await room.fetch(new Request('http://room/notify', { method: 'POST', headers: { 'x-blok-actor': JSON.stringify(actor), 'x-blok-story-id': 'story', 'x-blok-locale-id': 'locale', 'content-type': 'application/json' }, body: JSON.stringify(result) }))
    expect(response.status).toBe(200)
    expect(socket.send.mock.calls[0][0]).not.toContain('secret-lease')
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ type: 'commit', localeRevision: 7 })
  })
  it('rechecks subscribers before broadcasting content after permissions are revoked', async () => {
    mocks.assertActor.mockRejectedValue(new StorypaneError('forbidden', 'Removed from space'))
    const { socket, room } = fixture()
    await room.fetch(new Request('http://room/notify', { method: 'POST', headers: { 'x-blok-actor': JSON.stringify(actor), 'x-blok-story-id': 'story', 'x-blok-locale-id': 'locale' }, body: JSON.stringify({ type: 'leases' }) }))
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ type: 'error', code: 'forbidden' })
    expect(socket.close).toHaveBeenCalledWith(1008, 'Authentication expired')
  })
})
