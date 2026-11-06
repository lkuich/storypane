import type { ErrorCode, FieldIssue } from '@storypane/core';
import { spaceHeaders } from '../../lib/space-url';

export class ApiError extends Error {
  constructor(
    message: string,
    public code: ErrorCode | 'network',
    public details?: FieldIssue[],
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  return requestJson<T>(`/api/cms${path}`, {
    ...init,
    headers: { ...spaceHeaders(), ...init.headers },
  });
}

export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      signal: init.signal ?? AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError(
      'Connection interrupted. Your unsaved edits are kept on this device.',
      'network',
    );
  }
  let readable = true;
  const body = (await response.json().catch(() => {
    readable = false;
    return null;
  })) as {
    error?: { message?: string; code?: ErrorCode; details?: FieldIssue[] };
  } | null;
  if (!response.ok)
    throw new ApiError(
      body?.error?.message ?? `Request failed (${response.status})`,
      body?.error?.code ?? 'unavailable',
      body?.error?.details,
    );
  if (!readable)
    throw new ApiError(
      'The server response could not be read. Retry to confirm your change.',
      'unavailable',
    );
  return body as T;
}

export function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
export function fieldName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '');
}
export function dateLabel(value: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}
