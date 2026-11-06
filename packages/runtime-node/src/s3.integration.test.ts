import { describe, it, expect } from 'vitest';
import {
  S3Client,
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteBucketCommand,
} from '@aws-sdk/client-s3';
import { S3Bucket } from './s3';

// Opt in against disposable local S3; this test creates and removes only its own bucket.
describe.skipIf(!process.env.STORYPANE_TEST_S3_ENDPOINT)('S3 transport integration', () => {
  it('resumes multipart uploads and streams exact byte ranges', async () => {
    const endpoint = new URL(process.env.STORYPANE_TEST_S3_ENDPOINT!);
    if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname))
      throw new Error('Local S3 test target required');
    const client = new S3Client({
      endpoint: endpoint.href,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'storypane-test', secretAccessKey: 'local-test-only' },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    const name = `storypane-test-${crypto.randomUUID()}`;
    const bucket = new S3Bucket(client, name);
    await client.send(new CreateBucketCommand({ Bucket: name }));
    try {
      const upload = await bucket.createMultipartUpload('asset', {
        httpMetadata: { contentType: 'text/plain' },
      });
      const bytes = new TextEncoder().encode('0123456789');
      const part = await upload.uploadPart(1, bytes.buffer);
      const resumed = bucket.resumeMultipartUpload('asset', upload.uploadId);
      expect(await resumed.complete([part])).toMatchObject({
        size: 10,
        httpMetadata: { contentType: 'text/plain' },
      });
      const object = await bucket.get('asset', { range: { offset: 3, length: 4 } });
      expect(object).toMatchObject({ size: 10, range: { offset: 3, length: 4 } });
      expect(await new Response(object!.body).text()).toBe('3456');
      expect(await bucket.head('missing')).toBeNull();
      const cancelled = await bucket.createMultipartUpload('cancelled');
      await bucket.resumeMultipartUpload('cancelled', cancelled.uploadId).abort();
      await bucket.resumeMultipartUpload('cancelled', cancelled.uploadId).abort();
      await bucket.delete('asset');
      await bucket.delete('asset');
      expect(await bucket.head('asset')).toBeNull();
    } finally {
      await client.send(new DeleteObjectCommand({ Bucket: name, Key: 'asset' }));
      await client.send(new DeleteBucketCommand({ Bucket: name }));
      client.destroy();
    }
  });
});
