import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type { Installation } from '@storypane/db/installation';
import type { Room } from '@storypane/realtime/room';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const roomName = new RegExp(`^${uuid}:${uuid}:${uuid}$`, 'i');

/** Notifications are hints; every recipient's state is read and authorized in Postgres. */
export class RoomNotifications {
  private readonly origin = randomUUID();
  private client?: Client;
  private channel = '';
  private stopped = true;
  private retry?: ReturnType<typeof setTimeout>;
  private connecting?: Promise<void>;
  private readonly pending = new Set<string>();
  private refreshing?: Promise<void>;
  ready = false;

  constructor(
    private readonly installation: Pick<Installation, 'pool' | 'options'>,
    private readonly rooms: Map<string, { room: Pick<Room, 'refresh'> }>,
  ) {}

  async start() {
    this.stopped = false;
    this.connecting = this.connect();
    try {
      await this.connecting;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  private async connect() {
    const client = new Client({
      connectionString: this.installation.options.connectionString,
      application_name: 'storypane-rooms',
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });
    this.client = client;
    client.on('error', () => this.disconnected(client));
    client.on('end', () => this.disconnected(client));
    try {
      await client.connect();
      const { rows } = await client.query('SELECT current_schema() AS scope');
      const scope = createHash('sha256').update(rows[0].scope).digest('hex').slice(0, 16);
      this.channel = `storypane_rooms_${scope}`;
      client.on('notification', ({ channel, payload }) => {
        if (!this.ready || this.client !== client || channel !== this.channel || !payload) return;
        try {
          const message = JSON.parse(payload);
          if (
            typeof message.origin === 'string' &&
            message.origin !== this.origin &&
            typeof message.room === 'string' &&
            roomName.test(message.room)
          )
            this.enqueue(message.room);
        } catch {
          // Ignore malformed signals; no data or credentials are accepted from the channel.
        }
      });
      await client.query(`LISTEN "${this.channel}"`);
      if (this.stopped || this.client !== client) return;
      this.ready = true;
      // LISTEN first, then reread: notifications missed during a disconnect are not replayed.
      for (const name of this.rooms.keys()) this.enqueue(name);
    } catch (error) {
      this.disconnected(client);
      throw error;
    }
  }

  private disconnected(client: Client) {
    if (this.client !== client) return;
    this.ready = false;
    this.client = undefined;
    void client.end().catch(() => {});
    if (this.stopped || this.retry) return;
    console.error('Room notifications disconnected; reconnecting and resyncing clients.');
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.connecting = this.connect().catch(() => {});
    }, 1000);
  }

  private enqueue(name: string) {
    if (this.stopped || !this.rooms.has(name)) return;
    this.pending.add(name);
    if (!this.refreshing) this.refreshing = this.refresh();
  }

  private async refresh() {
    try {
      while (!this.stopped && this.pending.size) {
        const name = this.pending.values().next().value!;
        this.pending.delete(name);
        try {
          await this.rooms.get(name)?.room.refresh();
        } catch {
          console.error('Room refresh failed; clients will resync on heartbeat.');
        }
      }
    } finally {
      this.refreshing = undefined;
    }
  }

  async publish(name: string) {
    if (this.stopped || !this.channel || !roomName.test(name))
      throw new Error('Room notifications are not available');
    const query = {
      text: 'SELECT pg_notify($1, $2)',
      values: [this.channel, JSON.stringify({ room: name, origin: this.origin })],
      query_timeout: 5000,
    };
    await this.installation.pool.query(query);
  }

  async stop() {
    this.stopped = true;
    this.ready = false;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.pending.clear();
    const client = this.client;
    this.client = undefined;
    await client?.end().catch(() => {});
    await this.connecting?.catch(() => {});
    await this.refreshing;
  }
}
