import {
  StorypaneError,
  type Actor,
  type CommitResult,
  type LocaleSnapshot,
} from '@storypane/core';
import { StorypaneStore } from '@storypane/db';

export interface Env {
  HYPERDRIVE: { connectionString: string };
}
export type Connection = {
  actor: Actor;
  storyId: string;
  localeId: string;
  previewSessionId?: string;
};
const cleanSnapshot = (snapshot: LocaleSnapshot): LocaleSnapshot => ({
  ...snapshot,
  leases: snapshot.leases.map(({ token: _token, ...lease }) => lease),
});
const errorMessage = (error: unknown) =>
  error instanceof StorypaneError
    ? { type: 'error', code: error.code, message: error.message, details: error.details }
    : {
        type: 'error',
        code: 'unavailable',
        message: 'The collaboration service is unavailable. Your unsent edits are preserved.',
      };

export interface RoomSocket {
  send(message: string): void;
  close(code: number, reason: string): void;
  deserializeAttachment(): Connection | undefined;
}
export class Room {
  constructor(
    private ctx: { getWebSockets(): RoomSocket[] },
    private env: Env,
  ) {}

  private async withStore<T>(run: (store: StorypaneStore) => Promise<T>): Promise<T> {
    const store = new StorypaneStore(this.env.HYPERDRIVE.connectionString);
    try {
      return await run(store);
    } finally {
      await store.pool.end();
    }
  }
  private connection(request: Request): Connection {
    let actor: Actor;
    try {
      actor = JSON.parse(request.headers.get('x-storypane-actor') ?? '') as Actor;
    } catch {
      throw new StorypaneError('unauthenticated', 'Authentication is required');
    }
    const storyId = request.headers.get('x-storypane-story-id');
    const localeId = request.headers.get('x-storypane-locale-id');
    if (!actor.userId || !actor.sessionId || !actor.spaceId || !storyId || !localeId)
      throw new StorypaneError('unauthenticated', 'Authentication is required');
    return {
      actor,
      storyId,
      localeId,
      ...(request.headers.get('x-storypane-preview-id')
        ? { previewSessionId: request.headers.get('x-storypane-preview-id')! }
        : {}),
    };
  }
  private send(socket: RoomSocket, message: unknown): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      /* A disconnected client recovers committed state on reconnect. */
    }
  }
  private async broadcast(
    connection: { actor: Pick<Actor, 'spaceId'>; storyId: string; localeId: string },
    message: unknown,
  ): Promise<void> {
    await this.withStore(async (store) => {
      await Promise.all(
        this.ctx.getWebSockets().map(async (socket) => {
          const current = socket.deserializeAttachment() as Connection | undefined;
          if (
            current?.actor.spaceId !== connection.actor.spaceId ||
            current.storyId !== connection.storyId ||
            current.localeId !== connection.localeId
          )
            return;
          try {
            if (current.previewSessionId) {
              const story = await store.previewStory(current.previewSessionId);
              if (['commit', 'snapshot'].includes((message as { type: string }).type))
                this.send(socket, { type: 'content', story });
            } else {
              const snapshot = cleanSnapshot(
                await store.getSnapshot(current.actor, current.storyId, current.localeId),
              );
              const notification = message as { type: string; changedBlockIds?: string[] };
              if (notification.type === 'commit')
                this.send(socket, {
                  ...notification,
                  snapshot,
                  localeRevision: snapshot.revision,
                  checkpointId: snapshot.checkpointId,
                  changedBlockIds: notification.changedBlockIds?.filter(
                    (id) => !snapshot.access || snapshot.access.blocks[id]?.read === true,
                  ),
                });
              else if (notification.type === 'presence')
                this.send(socket, {
                  type: 'presence',
                  editors: [
                    ...new Map(
                      snapshot.leases.map((lease) => [
                        lease.sessionId,
                        { userId: lease.userId, sessionId: lease.sessionId },
                      ]),
                    ).values(),
                  ],
                });
              else this.send(socket, { type: 'snapshot', snapshot });
            }
          } catch (error) {
            this.send(socket, errorMessage(error));
            if (
              error instanceof StorypaneError &&
              ['unauthenticated', 'forbidden', 'not_found'].includes(error.code)
            )
              socket.close(1008, 'Authentication expired');
          }
        }),
      );
    });
  }
  private async presence(connection: Connection): Promise<void> {
    await this.broadcast(connection, { type: 'presence' });
  }
  async connect(
    request: Request,
    accept: (connection: Connection, protocol?: string) => RoomSocket,
  ): Promise<void> {
    const connection = this.connection(request);
    if (new URL(request.url).pathname === '/preview-live' && connection.previewSessionId) {
      const story = await this.withStore((store) =>
        store.previewStory(connection.previewSessionId!),
      );
      if (story.id !== connection.storyId || story.localeId !== connection.localeId)
        throw new StorypaneError('forbidden', 'Preview scope mismatch');
      this.send(accept(connection, 'storypane-preview'), { type: 'content', story });
      return;
    }
    if (new URL(request.url).pathname !== '/live' || connection.previewSessionId)
      throw new StorypaneError('invalid', 'Invalid collaboration endpoint');
    const snapshot = await this.withStore((store) =>
      store.getSnapshot(connection.actor, connection.storyId, connection.localeId),
    );
    this.send(accept(connection), { type: 'snapshot', snapshot });
    await this.presence(connection);
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/invalidate' && request.method === 'POST') {
        const spaceId = request.headers.get('x-storypane-space-id'),
          storyId = request.headers.get('x-storypane-story-id'),
          localeId = request.headers.get('x-storypane-locale-id');
        if (!spaceId || !storyId || !localeId)
          throw new StorypaneError('invalid', 'Missing room scope');
        await this.broadcast({ actor: { spaceId }, storyId, localeId }, { type: 'snapshot' });
        return Response.json({ ok: true });
      }
      const connection = this.connection(request);
      if (url.pathname === '/notify' && request.method === 'POST') {
        const snapshot = await this.withStore((store) =>
          store.getSnapshot(connection.actor, connection.storyId, connection.localeId),
        );
        const body = (await request.json()) as CommitResult | { type: 'leases' };
        if ('type' in body && body.type === 'leases')
          await this.broadcast(connection, {
            type: 'heartbeat',
            revision: snapshot.revision,
            checkpointId: snapshot.checkpointId,
            leases: cleanSnapshot(snapshot).leases,
          });
        else {
          const result = body as CommitResult;
          if (
            !result.snapshot ||
            result.snapshot.locale.id !== connection.localeId ||
            result.snapshot.story.id !== connection.storyId ||
            typeof result.localeRevision !== 'number'
          )
            throw new StorypaneError('invalid', 'Invalid commit notification');
          await this.broadcast(connection, {
            type: 'commit',
            ...result,
            snapshot: cleanSnapshot(result.snapshot),
          });
        }
        return Response.json({ ok: true });
      }
      return new Response('Not found', { status: 404 });
    } catch (error) {
      const body = errorMessage(error);
      const status =
        body.code === 'unauthenticated'
          ? 401
          : body.code === 'not_found'
            ? 404
            : body.code === 'forbidden'
              ? 403
              : body.code === 'invalid'
                ? 400
                : 503;
      return Response.json(body, { status });
    }
  }
  async webSocketMessage(socket: RoomSocket, raw: string | ArrayBuffer): Promise<void> {
    const connection = socket.deserializeAttachment() as Connection;
    try {
      if (typeof raw !== 'string' || raw.length > 4096)
        throw new StorypaneError('invalid', 'Invalid collaboration message');
      const message = JSON.parse(raw) as {
        type: string;
        revision?: number;
        referencesRevision?: string;
      };
      if (!['heartbeat', 'sync'].includes(message.type))
        throw new StorypaneError('invalid', 'Unsupported collaboration message');
      if (connection.previewSessionId) {
        const story = await this.withStore((store) =>
          store.previewStory(connection.previewSessionId!),
        );
        this.send(
          socket,
          message.type === 'sync' ||
            message.revision !== story.revision ||
            message.referencesRevision !== story.referencesRevision
            ? { type: 'content', story }
            : { type: 'heartbeat', revision: story.revision },
        );
        return;
      }
      const snapshot = await this.withStore((store) =>
        store.getSnapshot(connection.actor, connection.storyId, connection.localeId),
      );
      // A role can change without a content revision; always refresh the projected view.
      this.send(socket, { type: 'snapshot', snapshot });
    } catch (error) {
      this.send(socket, errorMessage(error));
      if (
        error instanceof StorypaneError &&
        ['unauthenticated', 'forbidden', 'not_found'].includes(error.code)
      )
        socket.close(1008, 'Authentication expired');
    }
  }
  async webSocketClose(socket: RoomSocket): Promise<void> {
    const connection = socket.deserializeAttachment() as Connection | undefined;
    if (connection && !connection.previewSessionId) await this.presence(connection);
  }
  async webSocketError(socket: RoomSocket): Promise<void> {
    socket.close(1011, 'Reconnect to resume');
  }
}
