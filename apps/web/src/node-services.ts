import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { env, nodeRoom, releaseRoom } from '@storypane/runtime-node';
import type { RoomSocket } from '@storypane/realtime/room';
import { liveRequest } from './lib/live';
import { errorResponse } from './lib/http';
import { createServices } from './lib/context';
import { startBackgroundTasks } from './lib/background';

export function attachNodeServices(server: Server) {
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    handleProtocols: (protocols) =>
      protocols.has('storypane-preview') ? 'storypane-preview' : false,
  });
  server.on('upgrade', async (request, socket, head) => {
    if (!request.url?.startsWith('/api/')) return;
    socket.on('error', () => socket.destroy());
    const timeout = setTimeout(() => socket.destroy(), 15_000);
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers))
        if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
      const live = await liveRequest(
        new Request(new URL(request.url || '/', env.APP_URL), { headers }),
      );
      if (!live) {
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        return;
      }
      const entry = nodeRoom(live.name);
      entry.pending++;
      try {
        await entry.room.connect(live.request, (connection) => {
          let peer: RoomSocket | undefined;
          sockets.handleUpgrade(request, socket, head, (ws) => {
            peer = {
              send: (message) => {
                if (ws.bufferedAmount > 1024 * 1024) ws.close(1013, 'Reconnect to resume');
                else ws.send(message);
              },
              close: (code, reason) => ws.close(code, reason),
              deserializeAttachment: () => connection,
            };
            const current = peer;
            entry.sockets.add(current);
            let messages = Promise.resolve();
            let queued = 0;
            ws.on('message', (raw, binary) => {
              if (++queued > 32) {
                ws.close(1008, 'Too many messages');
                return;
              }
              messages = messages
                .then(() =>
                  entry.room.webSocketMessage(
                    current,
                    binary ? new ArrayBuffer(0) : raw.toString(),
                  ),
                )
                .catch(() => ws.close(1011, 'Reconnect to resume'))
                .finally(() => {
                  queued--;
                });
            });
            ws.on('close', () => {
              entry.sockets.delete(current);
              void entry.room
                .webSocketClose(current)
                .catch(() => {})
                .finally(() => releaseRoom(live.name));
            });
            ws.on('error', () => {
              void entry.room.webSocketError(current);
            });
          });
          if (!peer) throw new Error('WebSocket upgrade failed');
          return peer;
        });
      } finally {
        entry.pending--;
        releaseRoom(live.name);
      }
    } catch (error) {
      const response = errorResponse(error);
      if (!socket.destroyed)
        socket.end(`HTTP/1.1 ${response.status} Error\r\nConnection: close\r\n\r\n`);
    } finally {
      clearTimeout(timeout);
    }
  });
  const stopBackground = startBackgroundTasks({
    installation: createServices().installation,
    rooms: env.ROOMS,
    webhookEncryptionKey: env.WEBHOOK_ENCRYPTION_KEY,
    webhookHosts: env.WEBHOOK_HOSTS.split(',')
      .map((host) => host.trim())
      .filter(Boolean),
    report: () =>
      console.error('Background tasks failed; pending work will retry on the next minute.'),
  });

  return async () => {
    for (const socket of sockets.clients) socket.close(1012, 'Service restarting');
    await stopBackground();
    sockets.close();
  };
}
