import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoomNotifications } from './room-notifications';

const connectionString =
  process.env.TEST_DATABASE_URL ??
  'postgresql://storypane:storypane@127.0.0.1:55432/storypane_test';
const target = new URL(connectionString);
if (
  !['localhost', '127.0.0.1'].includes(target.hostname) ||
  target.pathname !== `/${process.env.POSTGRES_DB ?? 'storypane'}_test`
)
  throw new Error('Room notification tests require the dedicated local test database');

const scope = `room_notifications_${randomUUID().replaceAll('-', '')}`;
const channel = `storypane_rooms_${createHash('sha256').update(scope).digest('hex').slice(0, 16)}`;
const name = () => [randomUUID(), randomUUID(), randomUUID()].join(':');
const pools: Pool[] = [];
const notifications: RoomNotifications[] = [];
const control = new Pool({ connectionString });
const make = (rooms: Map<string, { room: { refresh: () => Promise<void> } }>, schema = scope) => {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${schema},public`);
  const pool = new Pool({ connectionString: url.href, max: 2 });
  pools.push(pool);
  const transport = new RoomNotifications(
    {
      pool,
      options: { connectionString: url.href, encryptionKey: '', provider: 'local' },
    },
    rooms,
  );
  notifications.push(transport);
  return { pool, transport };
};

beforeEach(async () => {
  await control.query(`CREATE SCHEMA ${scope}`);
});
afterEach(async () => {
  await Promise.all(notifications.splice(0).map((transport) => transport.stop()));
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
  await control.query(`DROP SCHEMA ${scope} CASCADE`);
  vi.restoreAllMocks();
});
afterAll(() => control.end());

it('fans out identifiers through Postgres without echoing locally or sending content', async () => {
  const key = name();
  const first = vi.fn(async () => {}),
    second = vi.fn(async () => {});
  const a = make(new Map([[key, { room: { refresh: first } }]]));
  const b = make(new Map([[key, { room: { refresh: second } }]]));
  await Promise.all([a.transport.start(), b.transport.start()]);
  await vi.waitFor(() => {
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });
  first.mockClear();
  second.mockClear();
  const query = vi.spyOn(a.pool, 'query');
  await a.transport.publish(key);
  await vi.waitFor(() => expect(second).toHaveBeenCalledOnce());
  expect(first).not.toHaveBeenCalled();
  const input = query.mock.calls[0][0] as unknown as { text: string; values: string[] };
  expect(input.text).toBe('SELECT pg_notify($1, $2)');
  expect(input.values[0]).toBe(channel);
  expect(JSON.parse(input.values[1])).toEqual({ room: key, origin: expect.any(String) });
  await expect(a.transport.publish('invalid:room')).rejects.toThrow('not available');
});

it('ignores malformed signals and rooms without local recipients', async () => {
  const key = name(),
    barrier = name();
  const refresh = vi.fn(async () => {}),
    reached = vi.fn(async () => {});
  const rooms = new Map([
    [key, { room: { refresh } }],
    [barrier, { room: { refresh: reached } }],
  ]);
  const { transport, pool } = make(rooms);
  await transport.start();
  await vi.waitFor(() => expect(reached).toHaveBeenCalledOnce());
  refresh.mockClear();
  reached.mockClear();
  for (const payload of [
    'not-json',
    'null',
    '{}',
    JSON.stringify({ room: key }),
    JSON.stringify({ origin: 'peer', room: 'invalid' }),
    JSON.stringify({ origin: 'peer', room: name() }),
  ])
    await pool.query('SELECT pg_notify($1, $2)', [channel, payload]);
  await pool.query('SELECT pg_notify($1, $2)', [
    channel,
    JSON.stringify({ origin: 'peer', room: barrier }),
  ]);
  await vi.waitFor(() => expect(reached).toHaveBeenCalledOnce());
  expect(refresh).not.toHaveBeenCalled();
  expect(rooms.size).toBe(2);
});

it('reconnects and rereads committed state missed while the listener was down', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await control.query(`CREATE TABLE ${scope}.state(value text)`);
  await control.query(`INSERT INTO ${scope}.state VALUES('before')`);
  const key = name();
  const observed: string[] = [];
  const b = make(
    new Map([
      [
        key,
        {
          room: {
            refresh: async () => {
              observed.push(
                (await control.query(`SELECT value FROM ${scope}.state`)).rows[0].value,
              );
            },
          },
        },
      ],
    ]),
  );
  await b.transport.start();
  await vi.waitFor(() => expect(observed).toEqual(['before']));
  const listener = await control.query(
    "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='storypane-rooms' AND query=$1",
    [`LISTEN "${channel}"`],
  );
  expect(listener.rows).toHaveLength(1);
  await control.query('SELECT pg_terminate_backend($1)', [listener.rows[0].pid]);
  await vi.waitFor(() => expect(b.transport.ready).toBe(false));
  await control.query(`UPDATE ${scope}.state SET value='during disconnect'`);
  await control.query('SELECT pg_notify($1, $2)', [
    channel,
    JSON.stringify({ room: key, origin: 'peer' }),
  ]);
  await vi.waitFor(
    () => {
      expect(b.transport.ready).toBe(true);
      expect(observed).toContain('during disconnect');
    },
    { timeout: 5000 },
  );
  await b.transport.stop();
  expect(b.transport.ready).toBe(false);
  const remaining = await control.query(
    "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='storypane-rooms' AND query=$1",
    [`LISTEN "${channel}"`],
  );
  expect(remaining.rows).toHaveLength(0);
});

it('does not cross installation schemas sharing the same physical test database', async () => {
  const other = `${scope}_other`;
  await control.query(`CREATE SCHEMA ${other}`);
  const key = name(),
    barrier = name();
  const refresh = vi.fn(async () => {}),
    reached = vi.fn(async () => {});
  const a = make(new Map());
  const b = make(
    new Map([
      [key, { room: { refresh } }],
      [barrier, { room: { refresh: reached } }],
    ]),
    other,
  );
  try {
    await Promise.all([a.transport.start(), b.transport.start()]);
    await vi.waitFor(() => expect(reached).toHaveBeenCalledOnce());
    refresh.mockClear();
    reached.mockClear();
    await a.transport.publish(key);
    const otherChannel = `storypane_rooms_${createHash('sha256').update(other).digest('hex').slice(0, 16)}`;
    await b.pool.query('SELECT pg_notify($1, $2)', [
      otherChannel,
      JSON.stringify({ origin: 'peer', room: barrier }),
    ]);
    await vi.waitFor(() => expect(reached).toHaveBeenCalledOnce());
    expect(refresh).not.toHaveBeenCalled();
  } finally {
    await b.transport.stop();
    await control.query(`DROP SCHEMA ${other} CASCADE`);
  }
});

it('fails startup cleanly when the dedicated listener cannot connect', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const url = new URL(connectionString);
  url.port = '1';
  const pool = new Pool({ connectionString });
  pools.push(pool);
  const transport = new RoomNotifications(
    {
      pool,
      options: { connectionString: url.href, encryptionKey: '', provider: 'local' },
    },
    new Map(),
  );
  notifications.push(transport);
  await expect(transport.start()).rejects.toThrow();
  expect(transport.ready).toBe(false);
});
