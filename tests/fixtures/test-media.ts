import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { expect } from '@playwright/test';

const require = createRequire(new URL('../../packages/runtime-node/package.json', import.meta.url));
export const {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
export function mediaClient(env: Record<string, string | undefined>) {
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}
export async function startTestMedia() {
  const name = 'storypane-media-test-' + randomUUID();
  const accessKey = randomBytes(12).toString('hex'),
    secretKey = randomBytes(32).toString('hex');
  const docker = (...args: string[]) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      env: { ...process.env, MINIO_ROOT_USER: accessKey, MINIO_ROOT_PASSWORD: secretKey },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  docker(
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '-e',
    'MINIO_ROOT_USER',
    '-e',
    'MINIO_ROOT_PASSWORD',
    '--tmpfs',
    '/data:rw,size=256m',
    '-p',
    '127.0.0.1::9000',
    'ghcr.io/coollabsio/minio:RELEASE.2025-10-15T17-29-55Z@sha256:69b55a1c1c5dc285ce04db96689f5b2102317fc77a50680a1874ca6efd1c87f9',
    'server',
    '/data',
  );
  const port = docker('port', name, '9000').trim().split(':').at(-1);
  const env = {
    S3_ENDPOINT: `http://127.0.0.1:${port}`,
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'recovery',
    S3_ACCESS_KEY_ID: accessKey,
    S3_SECRET_ACCESS_KEY: secretKey,
    S3_FORCE_PATH_STYLE: 'true',
  };
  const client = mediaClient(env);
  try {
    await expect
      .poll(
        async () => {
          try {
            await client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 30000 },
      )
      .toBe(true);
  } catch (error) {
    docker('rm', '--force', name);
    throw error;
  } finally {
    client.destroy();
  }
  return {
    env,
    async close() {
      docker('rm', '--force', name);
    },
  };
}
