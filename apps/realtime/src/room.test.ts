import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorypaneError, type Actor, type LocaleSnapshot } from '@storypane/core';

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  assertActor: vi.fn(),
  preview: vi.fn(),
}));
import { Room } from './room';
import type { StorypaneStore } from '@storypane/db';

const env = {
  withStore: async <T>(run: (store: StorypaneStore) => Promise<T>): Promise<T> =>
    run({
      getSnapshot: mocks.snapshot,
      assertActor: mocks.assertActor,
      previewStory: mocks.preview,
    } as unknown as StorypaneStore),
};

const actor: Actor = { userId: 'alice', sessionId: 'session', spaceId: 'space', role: 'editor' };
const connection = { actor, storyId: 'story', localeId: 'locale' };
const snapshot = {
  story: { id: 'story' },
  locale: { id: 'locale' },
  revision: 7,
  checkpointId: 'checkpoint',
  blocks: [],
  definitions: [],
  leases: [
    {
      blockId: 'hero',
      userId: 'alice',
      sessionId: 'session',
      token: 'secret-lease',
      expiresAt: 'later',
    },
  ],
} as unknown as LocaleSnapshot;
function fixture(preview = false) {
  const socket = {
    send: vi.fn(),
    close: vi.fn(),
    deserializeAttachment: () => ({
      ...connection,
      ...(preview ? { previewSessionId: 'preview' } : {}),
    }),
  };
  const ctx = { getWebSockets: () => [socket] };
  const room = new Room(ctx, env);
  return { socket, room };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.snapshot.mockResolvedValue(snapshot);
  mocks.assertActor.mockResolvedValue(undefined);
});
describe('realtime recovery and authorization', () => {
  it('refreshes referenced drafts even when the parent story revision is unchanged', async () => {
    const story = {
      id: 'story',
      localeId: 'locale',
      revision: 7,
      referencesRevision: 'footer-v2',
      references: [{ id: 'footer', content: { text: 'Updated footer' } }],
    };
    mocks.preview.mockResolvedValue(story);
    const { socket, room } = fixture(true);
    await room.webSocketMessage(
      socket as never,
      JSON.stringify({ type: 'heartbeat', revision: 7, referencesRevision: 'footer-v1' }),
    );
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ type: 'content', story });
    await room.webSocketMessage(
      socket as never,
      JSON.stringify({ type: 'heartbeat', revision: 7, referencesRevision: 'footer-v2' }),
    );
    expect(JSON.parse(socket.send.mock.calls[1][0])).toEqual({ type: 'heartbeat', revision: 7 });
    mocks.preview.mockResolvedValue({ ...story, referencesRevision: 'empty', references: [] });
    await room.webSocketMessage(
      socket as never,
      JSON.stringify({ type: 'heartbeat', revision: 7, referencesRevision: 'footer-v2' }),
    );
    expect(JSON.parse(socket.send.mock.calls[2][0]).story.references).toEqual([]);
  });
  it('streams content-only preview snapshots and refuses editing commands', async () => {
    const story = { id: 'story', localeId: 'locale', revision: 7, content: { title: 'Draft' } };
    mocks.preview.mockResolvedValue(story);
    const { socket, room } = fixture(true);
    await room.webSocketMessage(socket as never, JSON.stringify({ type: 'sync' }));
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ type: 'content', story });
    expect(mocks.snapshot).not.toHaveBeenCalled();
    await room.webSocketMessage(socket as never, JSON.stringify({ type: 'saveBlock' }));
    expect(JSON.parse(socket.send.mock.calls[1][0])).toMatchObject({
      type: 'error',
      code: 'invalid',
    });
    mocks.preview.mockRejectedValue(new StorypaneError('unauthenticated', 'Revoked'));
    await room.webSocketMessage(socket as never, JSON.stringify({ type: 'heartbeat' }));
    expect(socket.close).toHaveBeenCalledWith(1008, 'Authentication expired');
  });
  it('resends current persisted snapshot on heartbeat revision gaps, including after restart', async () => {
    const { socket, room } = fixture();
    await room.webSocketMessage(
      socket as never,
      JSON.stringify({ type: 'heartbeat', revision: 6 }),
    );
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ type: 'snapshot', snapshot });
    const restarted = fixture();
    await restarted.room.webSocketMessage(
      restarted.socket as never,
      JSON.stringify({ type: 'sync' }),
    );
    expect(mocks.snapshot).toHaveBeenCalledWith(actor, 'story', 'locale');
    expect(JSON.parse(restarted.socket.send.mock.calls[0][0]).snapshot.revision).toBe(7);
  });
  it('does not report saved state when Postgres is unavailable', async () => {
    mocks.snapshot.mockRejectedValue(new Error('database down'));
    const { socket, room } = fixture();
    await room.webSocketMessage(
      socket as never,
      JSON.stringify({ type: 'heartbeat', revision: 7 }),
    );
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
      type: 'error',
      code: 'unavailable',
    });
  });
  it('rejects expired sessions and closes their socket', async () => {
    mocks.snapshot.mockRejectedValue(new StorypaneError('unauthenticated', 'Expired'));
    const { socket, room } = fixture();
    await room.webSocketMessage(socket as never, JSON.stringify({ type: 'sync' }));
    expect(socket.close).toHaveBeenCalledWith(1008, 'Authentication expired');
  });
  it('strips lease secrets from committed broadcasts', async () => {
    const { socket, room } = fixture();
    const result = {
      mutationId: 'mutation',
      localeRevision: 7,
      changedBlockIds: ['hero'],
      checkpointId: 'checkpoint',
      snapshot,
    };
    const response = await room.fetch(
      new Request('http://room/notify', {
        method: 'POST',
        headers: {
          'x-storypane-actor': JSON.stringify(actor),
          'x-storypane-story-id': 'story',
          'x-storypane-locale-id': 'locale',
          'content-type': 'application/json',
        },
        body: JSON.stringify(result),
      }),
    );
    expect(response.status).toBe(200);
    expect(socket.send.mock.calls[0][0]).not.toContain('secret-lease');
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
      type: 'commit',
      localeRevision: 7,
    });
  });
  it('rechecks subscribers before broadcasting content after permissions are revoked', async () => {
    mocks.snapshot
      .mockResolvedValueOnce(snapshot)
      .mockRejectedValueOnce(new StorypaneError('forbidden', 'Removed from space'));
    const { socket, room } = fixture();
    await room.fetch(
      new Request('http://room/notify', {
        method: 'POST',
        headers: {
          'x-storypane-actor': JSON.stringify(actor),
          'x-storypane-story-id': 'story',
          'x-storypane-locale-id': 'locale',
        },
        body: JSON.stringify({ type: 'leases' }),
      }),
    );
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
      type: 'error',
      code: 'forbidden',
    });
    expect(socket.close).toHaveBeenCalledWith(1008, 'Authentication expired');
  });
});

it('projects each committed broadcast for its recipient and invalidates without a creator session', async () => {
  const sockets = ['alice', 'bob'].map((userId) => ({
    send: vi.fn(),
    close: vi.fn(),
    deserializeAttachment: () => ({ ...connection, actor: { ...actor, userId } }),
  }));
  mocks.snapshot.mockImplementation(async (recipient: Actor) => ({
    ...snapshot,
    blocks: [
      {
        id: 'hero',
        fields: { title: recipient.userId === 'alice' ? 'Private value' : 'Visible value' },
      },
    ],
  }));
  const room = new Room({ getWebSockets: () => sockets }, env);
  const response = await room.fetch(
    new Request('http://room/invalidate', {
      method: 'POST',
      headers: {
        'x-storypane-space-id': 'space',
        'x-storypane-story-id': 'story',
        'x-storypane-locale-id': 'locale',
      },
    }),
  );
  expect(response.status).toBe(200);
  expect(sockets[0].send.mock.calls[0][0]).toContain('Private value');
  expect(sockets[1].send.mock.calls[0][0]).not.toContain('Private value');
  expect(sockets[1].send.mock.calls[0][0]).toContain('Visible value');
  expect(sockets[1].send.mock.calls[0][0]).not.toContain('secret-lease');
});
it('refreshes field permissions on a heartbeat even without a new revision', async () => {
  const { room, socket } = fixture();
  await room.webSocketMessage(socket as never, JSON.stringify({ type: 'heartbeat', revision: 7 }));
  expect(JSON.parse(socket.send.mock.calls[0][0]).type).toBe('snapshot');
});

it('never forwards changed IDs or field values from another subscriber’s full snapshot', async () => {
  const recipient = { ...actor, userId: 'bob' };
  const restricted = {
    ...snapshot,
    blocks: [{ id: 'visible', fields: { title: 'Visible' } }],
    access: { blocks: { visible: { read: true } } },
  };
  mocks.snapshot.mockImplementation(async (current: Actor) =>
    current.userId === 'bob' ? restricted : snapshot,
  );
  const socket = {
    send: vi.fn(),
    close: vi.fn(),
    deserializeAttachment: () => ({ ...connection, actor: recipient }),
  };
  const room = new Room({ getWebSockets: () => [socket] }, env);
  const response = await room.fetch(
    new Request('http://room/notify', {
      method: 'POST',
      headers: {
        'x-storypane-actor': JSON.stringify(actor),
        'x-storypane-story-id': 'story',
        'x-storypane-locale-id': 'locale',
      },
      body: JSON.stringify({
        mutationId: 'mutation',
        localeRevision: 7,
        checkpointId: 'checkpoint',
        changedBlockIds: ['visible', 'private', 'deleted-private'],
        snapshot: {
          ...snapshot,
          blocks: [{ id: 'private', fields: { title: 'Private content' } }],
        },
      }),
    }),
  );
  expect(response.status).toBe(200);
  const message = JSON.parse(socket.send.mock.calls[0][0]);
  expect(message.changedBlockIds).toEqual(['visible']);
  expect(JSON.stringify(message)).not.toContain('Private content');
  expect(JSON.stringify(message)).not.toContain('deleted-private');
});

it('refreshes remote recipients with their own authorization, including previews and revocation', async () => {
  const connections = [
    connection,
    { ...connection, actor: { ...actor, userId: 'restricted' } },
    { ...connection, actor: { ...actor, userId: 'revoked' } },
    { ...connection, previewSessionId: 'preview' },
  ];
  const sockets = connections.map((value) => ({
    send: vi.fn(),
    close: vi.fn(),
    deserializeAttachment: () => value,
  }));
  mocks.snapshot.mockImplementation(async (recipient: Actor) => {
    if (recipient.userId === 'revoked') throw new StorypaneError('forbidden', 'Removed');
    return {
      ...snapshot,
      blocks: [
        {
          id: 'hero',
          fields: {
            title: recipient.userId === 'alice' ? 'Private value' : 'Visible value',
          },
        },
      ],
    };
  });
  mocks.preview.mockResolvedValue({ id: 'story', content: { title: 'Preview content' } });
  const room = new Room({ getWebSockets: () => sockets }, env);
  await room.refresh();
  expect(sockets[0].send.mock.calls[0][0]).toContain('Private value');
  expect(sockets[1].send.mock.calls[0][0]).not.toContain('Private value');
  expect(sockets[1].send.mock.calls[0][0]).toContain('Visible value');
  expect(sockets[1].send.mock.calls[0][0]).not.toContain('secret-lease');
  expect(sockets[2].close).toHaveBeenCalledWith(1008, 'Authentication expired');
  expect(JSON.parse(sockets[3].send.mock.calls[0][0])).toEqual({
    type: 'content',
    story: { id: 'story', content: { title: 'Preview content' } },
  });
});

it('signals other processes when editors connect or leave', async () => {
  const onPresence = vi.fn(async () => {});
  const { socket } = fixture();
  const room = new Room({ getWebSockets: () => [socket] }, { ...env, onPresence });
  await room.connect(
    new Request('http://room/live', {
      headers: {
        'x-storypane-actor': JSON.stringify(actor),
        'x-storypane-story-id': 'story',
        'x-storypane-locale-id': 'locale',
      },
    }),
    () => socket,
  );
  await room.webSocketClose(socket);
  expect(onPresence).toHaveBeenCalledTimes(2);
});
