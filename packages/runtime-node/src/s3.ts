import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import {
  PART_BYTES,
  type AssetBucket,
  type AssetMultipart,
  type AssetObject,
} from '@storypane/assets';

export class S3Bucket implements AssetBucket {
  constructor(
    private client: S3Client,
    private bucket: string,
  ) {}
  async createMultipartUpload(
    key: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<AssetMultipart> {
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: options?.httpMetadata?.contentType,
      }),
    );
    if (!result.UploadId) throw new Error('S3 did not return an upload ID');
    return this.resumeMultipartUpload(key, result.UploadId);
  }
  resumeMultipartUpload(key: string, uploadId: string): AssetMultipart {
    const input = { Bucket: this.bucket, Key: key, UploadId: uploadId };
    return {
      uploadId,
      uploadPart: async (partNumber, body) => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (body instanceof ArrayBuffer) {
          if (body.byteLength > PART_BYTES) throw new Error('Upload part exceeds the part limit');
          chunks.push(new Uint8Array(body));
        } else {
          const reader = body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > PART_BYTES) throw new Error('Upload part exceeds the part limit');
              chunks.push(value);
            }
          } finally {
            await reader.cancel();
            reader.releaseLock();
          }
        }
        const bytes = Buffer.concat(chunks);
        const result = await this.client.send(
          new UploadPartCommand({
            ...input,
            PartNumber: partNumber,
            Body: bytes,
            ContentLength: bytes.byteLength,
          }),
        );
        if (!result.ETag) throw new Error('S3 did not return a part ETag');
        return { partNumber, etag: result.ETag };
      },
      complete: async (parts) => {
        await this.client.send(
          new CompleteMultipartUploadCommand({
            ...input,
            MultipartUpload: {
              Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
            },
          }),
        );
        const object = await this.head(key);
        if (!object) throw new Error('Completed S3 object is missing');
        return object;
      },
      abort: async () => {
        try {
          await this.client.send(new AbortMultipartUploadCommand(input));
        } catch (error) {
          if (!missing(error)) throw error;
        }
      },
    };
  }
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async head(key: string): Promise<AssetObject | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        size: result.ContentLength!,
        httpEtag: result.ETag!,
        httpMetadata: { contentType: result.ContentType },
      };
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }
  async get(key: string, options?: { range?: Headers | { offset: number; length: number } }) {
    const range = options?.range;
    const header =
      range instanceof Headers
        ? (range.get('range') ?? undefined)
        : range
          ? `bytes=${range.offset}-${range.offset + range.length - 1}`
          : undefined;
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: header }),
      );
      if (!result.Body) throw new Error('S3 returned an empty object body');
      const match = result.ContentRange?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      return {
        size: match ? Number(match[3]) : result.ContentLength!,
        httpEtag: result.ETag!,
        httpMetadata: { contentType: result.ContentType },
        body: result.Body.transformToWebStream(),
        ...(match
          ? { range: { offset: Number(match[1]), length: Number(match[2]) - Number(match[1]) + 1 } }
          : {}),
      };
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }
}
function missing(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    '$metadata' in error &&
    (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 404
  );
}
