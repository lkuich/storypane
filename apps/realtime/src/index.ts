import { DurableObject } from 'cloudflare:workers';
import { Room, type Env } from './room';

export class StoryRoom extends DurableObject<Env> {
  private room = new Room(this.ctx, this.env);
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
      return this.room.fetch(request);
    let response: Response | undefined;
    await this.room.connect(request, (connection, protocol) => {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment(connection);
      response = new Response(null, {
        status: 101,
        webSocket: pair[0],
        ...(protocol ? { headers: { 'Sec-WebSocket-Protocol': protocol } } : {}),
      });
      return pair[1];
    });
    return response!;
  }
  webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    return this.room.webSocketMessage(socket, raw);
  }
  webSocketClose(socket: WebSocket) {
    return this.room.webSocketClose(socket);
  }
  webSocketError(socket: WebSocket) {
    return this.room.webSocketError(socket);
  }
}

// Rooms are reached only through the application's authenticated service binding.
export default {
  fetch() {
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
