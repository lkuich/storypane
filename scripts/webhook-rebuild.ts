/** Single-process static site build receiver. Put behind an HTTPS reverse proxy. */
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { verifyWebhookSignature } from '@storypane/db';
import { webhookEventTypes, type WebhookEvent } from '@storypane/core';

const runFile = promisify(execFile);
const rebuildEvents = new Set([
  'story.published',
  'story.unpublished',
  'story.deleted',
  'asset.updated',
  'schema.deployed',
]);

export function createRebuildReceiver(options: {
  databasePath: string;
  secret: string;
  spaceId: string;
  build: () => Promise<void>;
  now?: () => number;
}) {
  const db = new DatabaseSync(options.databasePath);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS builds (id TEXT PRIMARY KEY, body_hash TEXT NOT NULL, status TEXT NOT NULL, next_attempt INTEGER NOT NULL, created_at INTEGER NOT NULL);
    UPDATE builds SET status='pending' WHERE status='building';`);
  const now = options.now ?? Date.now;
  let running: Promise<void> | undefined;
  async function runPending() {
    if (running) return running;
    running = (async () => {
      // Bound each pass so the process can observe shutdown between builds.
      for (let i = 0; i < 25; i++) {
        const row = db
          .prepare(
            "SELECT id FROM builds WHERE status='pending' AND next_attempt<=? ORDER BY created_at LIMIT 1",
          )
          .get(now()) as { id: string } | undefined;
        if (!row) break;
        db.prepare("UPDATE builds SET status='building' WHERE id=?").run(row.id);
        try {
          await options.build();
          db.prepare("UPDATE builds SET status='done' WHERE id=?").run(row.id);
        } catch {
          // Preserve accepted work; retry builds independently of outbound webhook retries.
          db.prepare("UPDATE builds SET status='pending',next_attempt=? WHERE id=?").run(
            now() + 60_000,
            row.id,
          );
          break;
        }
      }
      db.prepare("DELETE FROM builds WHERE status='done' AND created_at<?").run(
        now() - 30 * 86_400_000,
      );
    })();
    try {
      await running;
    } finally {
      running = undefined;
    }
  }
  async function receive(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (new URL(request.url).pathname !== '/webhook') return new Response(null, { status: 404 });
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 32_768) return new Response(null, { status: 413 });
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
      }
    }
    const body = Buffer.concat(chunks).toString('utf8');
    if (
      !(await verifyWebhookSignature(
        options.secret,
        request.headers.get('Webhook-Timestamp') ?? '',
        body,
        request.headers.get('Webhook-Signature') ?? '',
        now(),
      ))
    )
      return new Response(null, { status: 401 });
    let event: WebhookEvent;
    try {
      event = JSON.parse(body) as WebhookEvent;
    } catch {
      return new Response(null, { status: 400 });
    }
    if (
      !event ||
      event.version !== 1 ||
      event.spaceId !== options.spaceId ||
      typeof event.id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(event.id) ||
      event.id !== request.headers.get('Webhook-Id') ||
      (event.type !== 'webhook.test' && !webhookEventTypes.includes(event.type))
    )
      return new Response(null, { status: 400 });
    const hash = createHash('sha256').update(body).digest('hex');
    const previous = db.prepare('SELECT body_hash FROM builds WHERE id=?').get(event.id) as
      { body_hash: string } | undefined;
    if (previous && previous.body_hash !== hash) return new Response(null, { status: 409 });
    // Commit durable deduplication/queue state before acknowledging acceptance.
    db.prepare(
      'INSERT OR IGNORE INTO builds(id,body_hash,status,next_attempt,created_at) VALUES(?,?,?,?,?)',
    ).run(event.id, hash, rebuildEvents.has(event.type) ? 'pending' : 'done', now(), now());
    return new Response(null, { status: 202 });
  }
  return {
    receive,
    runPending,
    async close() {
      await running;
      db.close();
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const secret = process.env.WEBHOOK_SIGNING_SECRET,
    spaceId = process.env.STORYPANE_SPACE_ID,
    directory = process.env.SITE_DIRECTORY,
    databasePath = process.env.WEBHOOK_BUILD_DATABASE;
  if (!secret || !spaceId || !directory || !databasePath || !process.env.STORYPANE_DELIVERY_TOKEN)
    throw new Error(
      'Set WEBHOOK_SIGNING_SECRET, STORYPANE_SPACE_ID, SITE_DIRECTORY, WEBHOOK_BUILD_DATABASE, and STORYPANE_DELIVERY_TOKEN',
    );
  const receiver = createRebuildReceiver({
    databasePath,
    secret,
    spaceId,
    build: async () => {
      // The configured site reads STORYPANE_DELIVERY_TOKEN server-side while building.
      // Fixed executable/arguments: event data can never select a command or directory.
      await runFile('pnpm', ['build'], {
        cwd: directory,
        env: process.env,
        timeout: 600_000,
        maxBuffer: 1_048_576,
      });
    },
  });
  const timer = setInterval(() => {
    void receiver.runPending().catch(() => console.error('Build queue could not be processed'));
  }, 1000);
  const server = createServer(
    { requestTimeout: 10_000, headersTimeout: 10_000 },
    async (incoming, outgoing) => {
      try {
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) {
          size += chunk.length;
          if (size > 32_768) {
            outgoing.writeHead(413).end();
            return;
          }
          chunks.push(chunk);
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers))
          if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value);
        const response = await receiver.receive(
          new Request('http://localhost' + incoming.url, {
            method: incoming.method,
            headers,
            ...(incoming.method === 'POST' ? { body: Buffer.concat(chunks).toString('utf8') } : {}),
          }),
        );
        outgoing.writeHead(response.status).end();
      } catch {
        outgoing.writeHead(500).end();
      }
    },
  );
  server.listen(Number(process.env.WEBHOOK_BUILD_PORT ?? 3138), '127.0.0.1');
  const stop = () => {
    clearInterval(timer);
    server.close(() => {
      void receiver.close();
    });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
