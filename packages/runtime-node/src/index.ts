import { S3Client } from '@aws-sdk/client-s3';
import { Room, type RoomSocket } from '@storypane/realtime/room';
import { S3Bucket } from './s3';
import { images } from './images';

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
const rooms = new Map<string, { room: Room; sockets: Set<RoomSocket>; pending: number }>();
export function nodeRoom(name: string) {
  let entry = rooms.get(name);
  if (!entry) {
    const sockets = new Set<RoomSocket>();
    entry = {
      sockets,
      pending: 0,
      room: new Room(
        { getWebSockets: () => [...sockets] },
        { HYPERDRIVE: { connectionString: required('DATABASE_URL') } },
      ),
    };
    rooms.set(name, entry);
  }
  return entry;
}
export function releaseRoom(name: string) {
  const entry = rooms.get(name);
  if (entry && entry.pending === 0 && entry.sockets.size === 0) rooms.delete(name);
}
let bucket: S3Bucket | undefined;
export const env = {
  get HYPERDRIVE() {
    return { connectionString: required('DATABASE_URL') };
  },
  get APP_URL() {
    return process.env.STORYPANE_APP_URL || `https://${required('RAILWAY_PUBLIC_DOMAIN')}`;
  },
  get CLERK_SECRET_KEY() {
    return required('CLERK_SECRET_KEY');
  },
  get VITE_CLERK_PUBLISHABLE_KEY() {
    return required('VITE_CLERK_PUBLISHABLE_KEY');
  },
  get WEBHOOK_ENCRYPTION_KEY() {
    return required('WEBHOOK_ENCRYPTION_KEY');
  },
  get EXTERNAL_OPTION_HOSTS() {
    return process.env.EXTERNAL_OPTION_HOSTS || '';
  },
  get WEBHOOK_HOSTS() {
    return process.env.WEBHOOK_HOSTS || '';
  },
  get MEDIA() {
    return (bucket ??= new S3Bucket(
      new S3Client({
        endpoint: required('S3_ENDPOINT'),
        region: required('S3_REGION'),
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
        credentials: {
          accessKeyId: required('S3_ACCESS_KEY_ID'),
          secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
        },
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      }),
      required('S3_BUCKET'),
    ));
  },
  IMAGES: images,
  ROOMS: {
    getByName(name: string) {
      return {
        async fetch(request: Request) {
          const entry = rooms.get(name);
          // No connected recipients means nothing to notify; committed data lives in Postgres.
          return entry ? entry.room.fetch(request) : Response.json({ ok: true });
        },
      };
    },
  },
};
// shortcut: variants are computed on demand, add a bounded cache when profiling justifies it.
export async function openCache(_name: string) {
  return undefined;
}

export function validateEnvironment() {
  for (const key of [
    'DATABASE_URL',
    'CLERK_SECRET_KEY',
    'VITE_CLERK_PUBLISHABLE_KEY',
    'WEBHOOK_ENCRYPTION_KEY',
    'S3_ENDPOINT',
    'S3_REGION',
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ])
    required(key);
  const origin = new URL(env.APP_URL);
  if (
    origin.origin !== env.APP_URL ||
    (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(origin.hostname))
  )
    throw new Error('STORYPANE_APP_URL must be an HTTPS origin');
  if (Buffer.from(env.WEBHOOK_ENCRYPTION_KEY, 'base64').length !== 32)
    throw new Error('WEBHOOK_ENCRYPTION_KEY must encode 32 bytes');
}
