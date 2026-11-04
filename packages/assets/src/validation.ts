export const MAX_ASSET_BYTES = 1024 * 1024 * 1024;
export const PART_BYTES = 10 * 1024 * 1024;
export const ASSET_TYPES: Record<string, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'image/avif': ['avif'],
  'video/mp4': ['mp4', 'm4v'],
  'video/webm': ['webm'],
  'video/quicktime': ['mov'],
  'application/pdf': ['pdf'],
  'text/plain': ['txt'],
  'text/csv': ['csv'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
};

export class AssetError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function assert(value: unknown, message: string): asserts value {
  if (!value) throw new AssetError(400, 'invalid', message);
}

export function text(value: unknown, name: string, max: number, fallback = ''): string {
  const result = value === undefined ? fallback : value;
  assert(
    typeof result === 'string' && result.length <= max,
    `${name} must be at most ${max} characters`,
  );
  return result.trim();
}

export function uploadInput(input: Record<string, unknown>) {
  const filename = text(input.filename, 'Filename', 255);
  const mimeType = text(input.mimeType, 'MIME type', 150).toLowerCase();
  const extensions = Object.hasOwn(ASSET_TYPES, mimeType) ? ASSET_TYPES[mimeType] : undefined;
  // eslint-disable-next-line no-control-regex -- Reject control characters and path separators in filenames.
  assert(filename.length > 0 && !/[\x00-\x1f/\\]/.test(filename), 'Invalid filename');
  assert(
    extensions?.includes(filename.split('.').pop()?.toLowerCase() ?? ''),
    'Unsupported file type or extension',
  );
  assert(
    Number.isSafeInteger(input.byteSize) &&
      Number(input.byteSize) > 0 &&
      Number(input.byteSize) <= MAX_ASSET_BYTES,
    'File must be between 1 byte and 1 GiB',
  );
  return { filename, mimeType, byteSize: Number(input.byteSize) };
}

export function metadata(input: Record<string, unknown>, fallbackTitle = '') {
  const title = text(input.title, 'Title', 200, fallbackTitle);
  assert(title.length > 0, 'Title is required');
  const tags = input.tags ?? [];
  assert(
    Array.isArray(tags) &&
      tags.length <= 30 &&
      tags.every((t) => typeof t === 'string' && t.trim().length > 0 && t.length <= 60),
    'Use at most 30 tags of 60 characters',
  );
  return {
    title,
    alt: text(input.alt, 'Alt text', 1000),
    notes: text(input.notes, 'Notes', 5000),
    tags: [...new Set(tags.map((t) => (t as string).trim()))],
  };
}

export function focalPoint(value: unknown): { x: number; y: number } | null {
  if (value === null) return null;
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Invalid focal point');
  const point = value as Record<string, unknown>;
  assert(
    Object.keys(point).length === 2 && Object.hasOwn(point, 'x') && Object.hasOwn(point, 'y'),
    'Use focal coordinates x and y',
  );
  assert(
    typeof point.x === 'number' &&
      Number.isFinite(point.x) &&
      point.x >= 0 &&
      point.x <= 1 &&
      typeof point.y === 'number' &&
      Number.isFinite(point.y) &&
      point.y >= 0 &&
      point.y <= 1,
    'Focal coordinates must be between 0 and 1',
  );
  return { x: point.x, y: point.y };
}

export function signatureMatches(mime: string, bytes: Uint8Array): boolean {
  const starts = (...values: number[]) => values.every((value, i) => bytes[i] === value);
  const at = (offset: number, value: string) =>
    new TextDecoder().decode(bytes.subarray(offset, offset + value.length)) === value;
  switch (mime) {
    case 'image/jpeg':
      return starts(255, 216, 255);
    case 'image/png':
      return starts(137, 80, 78, 71, 13, 10, 26, 10);
    case 'image/gif':
      return at(0, 'GIF87a') || at(0, 'GIF89a');
    case 'image/webp':
      return at(0, 'RIFF') && at(8, 'WEBP');
    case 'image/avif':
      return at(4, 'ftyp') && (at(8, 'avif') || at(8, 'avis'));
    case 'video/mp4':
    case 'video/quicktime':
      return at(4, 'ftyp');
    case 'video/webm':
      return starts(26, 69, 223, 163);
    case 'application/pdf':
      return at(0, '%PDF-');
    case 'application/msword':
      return starts(208, 207, 17, 224, 161, 177, 26, 225);
    case 'text/plain':
    case 'text/csv':
      return !bytes.includes(0);
    default:
      return mime.startsWith('application/vnd.openxmlformats-') && starts(80, 75, 3, 4);
  }
}
