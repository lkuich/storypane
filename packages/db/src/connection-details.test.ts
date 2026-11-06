import { randomBytes, randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { Installation, sealConnection } from './installation.js';

it('masks passwords by default and requires installation privileges for every reveal', async () => {
  const spaceId = randomUUID(),
    key = randomBytes(32).toString('base64');
  const fullUrl =
    'postgresql://space_role:private%40password%3A%2F%3F%23@db.internal:55450/content?sslmode=require';
  const installation = new Installation({
    connectionString: 'postgresql://unused',
    encryptionKey: key,
    provider: 'local',
  });
  const admin = vi.spyOn(installation, 'isAdmin').mockResolvedValue(false);
  const query = vi.spyOn(installation.pool, 'query').mockResolvedValue({
    rows: [
      {
        status: 'ready',
        connection_secret: sealConnection(fullUrl, key, spaceId),
      },
    ],
  } as never);
  try {
    await expect(installation.connectionDetails('space-admin', spaceId)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(query).not.toHaveBeenCalled();
    admin.mockResolvedValue(true);
    const result = await installation.connectionDetails('installation-admin', spaceId);
    expect(result).toEqual({
      status: 'ready',
      url: 'postgresql://space_role:********@db.internal:55450/content?sslmode=require',
    });
    expect(JSON.stringify(result)).not.toMatch(/private|connection_secret/);
    expect(await installation.connectionDetails('installation-admin', spaceId, true)).toEqual({
      status: 'ready',
      url: fullUrl,
    });
    admin.mockResolvedValueOnce(false);
    const count = query.mock.calls.length;
    await expect(
      installation.connectionDetails('space-admin', spaceId, true),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(query).toHaveBeenCalledTimes(count);
    query.mockResolvedValueOnce({ rows: [{ status: 'failed', connection_secret: null }] } as never);
    expect(await installation.connectionDetails('installation-admin', spaceId)).toEqual({
      status: 'failed',
      url: null,
    });
    query.mockResolvedValueOnce({ rows: [] } as never);
    await expect(
      installation.connectionDetails('installation-admin', spaceId),
    ).rejects.toMatchObject({ code: 'not_found' });
  } finally {
    vi.restoreAllMocks();
    await installation.pool.end();
  }
});
