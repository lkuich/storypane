import type { Pool } from 'pg';
import type { Actor } from '@blok/core';

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
}

export interface AssetFolder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface AssetPart { partNumber: number; etag: string }
export interface AssetObject {
  size: number;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
  range?: { offset?: number; length?: number; suffix?: number };
}
export interface AssetObjectBody extends AssetObject { body: ReadableStream<Uint8Array> }
export interface AssetMultipart {
  uploadId: string;
  uploadPart(partNumber: number, body: ReadableStream<Uint8Array> | ArrayBuffer): Promise<AssetPart>;
  complete(parts: AssetPart[]): Promise<AssetObject>;
  abort(): Promise<void>;
}

export interface AssetBucket {
  createMultipartUpload(key: string, options?: { httpMetadata?: { contentType?: string } }): Promise<AssetMultipart>;
  resumeMultipartUpload(key: string, uploadId: string): AssetMultipart;
  head(key: string): Promise<AssetObject | null>;
  get(key: string, options?: { range?: Headers | { offset: number; length: number } }): Promise<AssetObjectBody | null>;
}

export interface AssetContext { db: Pool; actor: Actor; bucket: AssetBucket; images?: Pick<ImagesBinding, 'input'>; cache?: Pick<Cache, 'match' | 'put'> }
