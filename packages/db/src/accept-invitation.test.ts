import { expect, it, vi } from 'vitest';
import type { Installation } from './installation';
import { acceptInvitation } from './accept-invitation';

it.each(['space', 'installation'] as const)(
  'releases acquired resources when the %s connection fails',
  async (failure) => {
    const error = new Error('Database unavailable');
    const space = { query: vi.fn(), release: vi.fn() };
    const selected = {
      db: {
        connect:
          failure === 'space' ? vi.fn().mockRejectedValue(error) : vi.fn().mockResolvedValue(space),
      },
      close: vi.fn(),
    };
    const installation = {
      acquire: vi.fn().mockResolvedValue(selected),
      pool: { connect: vi.fn().mockRejectedValue(error) },
    } as unknown as Installation;
    await expect(
      acceptInvitation(installation, {
        spaceId: crypto.randomUUID(),
        token: `si_${'a'.repeat(43)}`,
      }),
    ).rejects.toBe(error);
    expect(selected.close).toHaveBeenCalledOnce();
    expect(space.release).toHaveBeenCalledTimes(failure === 'space' ? 0 : 1);
  },
);
