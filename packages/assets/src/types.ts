import type { Pool } from 'pg';
import type { Actor } from '@storypane/core';

export interface AssetRecord {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  title: string;
  alt: string;
  notes: string;
  tags: string[];
  folderIds: string[];
  archivedAt: string | null;
  createdAt: string;
  focalPoint: { x: number; y: number } | null;
  metadataRevision: number;
}

export interface AssetFolder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface AssetPart {
  partNumber: number;
  etag: string;
}
export interface AssetObject {
  size: number;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
  range?: { offset?: number; length?: number; suffix?: number };
}
export interface AssetObjectBody extends AssetObject {
  body: ReadableStream<Uint8Array>;
}
export interface AssetMultipart {
  uploadId: string;
  uploadPart(
    partNumber: number,
    body: ReadableStream<Uint8Array> | ArrayBuffer,
  ): Promise<AssetPart>;
  complete(parts: AssetPart[]): Promise<AssetObject>;
  abort(): Promise<void>;
}

export interface AssetBucket {
  createMultipartUpload(
    key: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<AssetMultipart>;
  resumeMultipartUpload(key: string, uploadId: string): AssetMultipart;
  head(key: string): Promise<AssetObject | null>;
  get(
    key: string,
    options?: { range?: Headers | { offset: number; length: number } },
  ): Promise<AssetObjectBody | null>;
}

export interface AssetContext {
  db: Pool;
  actor: Actor;
  canWrite: boolean;
  bucket: AssetBucket;
  images?: AssetImages;
  cache?: Pick<Cache, 'match' | 'put'>;
}

export interface AssetImageTransform {
  width: number;
  height?: number;
  fit: 'scale-down' | 'cover' | 'contain';
  gravity?: { x: number; y: number; mode: 'remainder' };
}
export interface AssetImages {
  input(body: ReadableStream<Uint8Array>): {
    transform(options: AssetImageTransform): {
      output(options: {
        format: 'image/webp' | 'image/jpeg' | 'image/png';
        quality?: number;
        anim: false;
      }): Promise<{ response(): Response }>;
    };
  };
}
