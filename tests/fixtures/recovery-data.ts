import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalJson } from '@storypane/core';

export function rowDigest(rows: unknown[]) {
  return createHash('sha256')
    .update(JSON.stringify(rows.map(canonicalJson).sort()))
    .digest('hex');
}
export function assertDisposableRailway(
  context: {
    createdBy: string;
    projectId: string;
    origin: string;
    serviceId: string;
    environmentId: string;
  },
  project: { id: string; name: string },
) {
  assert.equal(
    context.createdBy,
    'storypane-operational-tests',
    'Only a generated regression fixture may be changed',
  );
  assert.equal(project.id, context.projectId, 'Railway project mismatch');
  assert.match(
    project.name,
    /^storypane-regression-\d{4}-\d{2}-\d{2}(?:-[a-z0-9-]+)?$/,
    'Use a disposable regression project',
  );
  assert.match(context.serviceId, /^[a-f0-9-]{36}$/);
  assert.match(context.environmentId, /^[a-f0-9-]{36}$/);
  const url = new URL(context.origin);
  assert.equal(url.protocol, 'https:');
  assert(url.hostname.endsWith('.up.railway.app'));
  assert.equal(url.origin, context.origin);
}
