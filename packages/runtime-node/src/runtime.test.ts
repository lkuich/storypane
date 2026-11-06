import { describe, expect, it, vi, afterEach } from 'vitest';
import sharp from 'sharp/lib/index.js';
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { S3Bucket } from './s3';
import { images, focalCrop } from './images';
import { minuteScheduler } from './scheduler';
import { env, nodeRoom, releaseRoom } from './index';
import { PART_BYTES } from '@storypane/assets';

const stream = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('Node runtime adapters', () => {
  it('requires an explicit application origin regardless of hosting provider', () => {
    vi.stubEnv('STORYPANE_APP_URL', undefined);
    vi.stubEnv('RAILWAY_PUBLIC_DOMAIN', 'cms.example.com');
    expect(() => env.APP_URL).toThrow('Missing STORYPANE_APP_URL');
    vi.stubEnv('STORYPANE_APP_URL', 'https://cms.example.com');
    expect(env.APP_URL).toBe('https://cms.example.com');
  });
  it('retains a room while another authenticated connection is opening', () => {
    const first = nodeRoom('concurrent');
    first.pending++;
    releaseRoom('concurrent');
    expect(nodeRoom('concurrent')).toBe(first);
    first.pending--;
    releaseRoom('concurrent');
    expect(nodeRoom('concurrent')).not.toBe(first);
    releaseRoom('concurrent');
  });
  it('retains multipart ETags and whole-object size for ranged downloads', async () => {
    const send = vi
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation(async (command: unknown) => {
        if (command instanceof UploadPartCommand) {
          expect(command.input.UploadId).toBe('upload');
          expect(command.input.ContentLength).toBe(3);
          return { ETag: 'part-etag' };
        }
        if (command instanceof GetObjectCommand) {
          expect(command.input.Range).toBe('bytes=2-4');
          return {
            Body: { transformToWebStream: () => stream(new Uint8Array([1, 2, 3])) },
            ContentLength: 3,
            ContentRange: 'bytes 2-4/10',
            ETag: 'original',
          };
        }
        if (command instanceof HeadObjectCommand) return { ContentLength: 10, ETag: 'original' };
        return {};
      });
    const bucket = new S3Bucket(new S3Client({ region: 'auto' }), 'private');
    const upload = bucket.resumeMultipartUpload('asset', 'upload');
    expect(await upload.uploadPart(1, stream(new Uint8Array([1, 2, 3])))).toEqual({
      partNumber: 1,
      etag: 'part-etag',
    });
    expect(await upload.complete([{ partNumber: 1, etag: 'part-etag' }])).toMatchObject({
      size: 10,
      httpEtag: 'original',
    });
    const object = await bucket.get('asset', { range: { offset: 2, length: 3 } });
    expect(object).toMatchObject({ size: 10, range: { offset: 2, length: 3 } });
    expect(await new Response(object!.body).arrayBuffer()).toHaveProperty('byteLength', 3);
    send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    expect(await bucket.head('absent')).toBeNull();
    send.mockRejectedValueOnce(new Error('access denied'));
    await expect(bucket.head('private')).rejects.toThrow('access denied');
    await expect(upload.uploadPart(1, stream(new Uint8Array(PART_BYTES + 1)))).rejects.toThrow(
      'part limit',
    );
  });
  it('keeps focal points, image formats, bounds and scale-down behavior', async () => {
    expect(
      focalCrop(400, 200, {
        width: 100,
        height: 100,
        fit: 'cover',
        gravity: { x: 1, y: 0, mode: 'remainder' },
      }),
    ).toEqual({ left: 200, top: 0, width: 200, height: 200 });
    const source = await sharp({
      create: { width: 400, height: 200, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    for (const format of ['image/webp', 'image/jpeg', 'image/png'] as const) {
      const output = await images
        .input(stream(source))
        .transform({
          width: 160,
          height: 160,
          fit: 'cover',
          gravity: { x: 1, y: 0, mode: 'remainder' },
        })
        .output({ format, anim: false });
      const response = output.response();
      expect(response.headers.get('content-type')).toBe(format);
      expect(await sharp(Buffer.from(await response.arrayBuffer())).metadata()).toMatchObject({
        width: 160,
        height: 160,
      });
    }
    const output = await images
      .input(stream(source))
      .transform({ width: 640, fit: 'scale-down' })
      .output({ format: 'image/webp', anim: false });
    expect(
      await sharp(Buffer.from(await output.response().arrayBuffer())).metadata(),
    ).toMatchObject({ width: 400, height: 200 });
    await expect(
      images
        .input(stream(new Uint8Array(20 * 1024 * 1024 + 1)))
        .transform({ width: 160, fit: 'scale-down' })
        .output({ format: 'image/webp', anim: false }),
    ).rejects.toThrow('20 MiB');
  });
  it('runs immediately, prevents overlapping ticks, retries failures and drains on stop', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const run = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue(undefined);
    const report = vi.fn();
    const stop = minuteScheduler(run, report);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(report).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(3);
    await stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(3);
  });
});
