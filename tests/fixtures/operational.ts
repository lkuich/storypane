import { test as base, expect } from '@playwright/test';
import { webhookInstallation } from './webhook-installation';
import { railwayInstallation } from './railway-installation';
export type OperationalInstallation =
  Awaited<ReturnType<typeof webhookInstallation>> | Awaited<ReturnType<typeof railwayInstallation>>;
export const test = base.extend<object, { installation: OperationalInstallation }>({
  installation: [
    async ({ playwright: _playwright }, runWithFixture) => {
      const fixture = process.env.STORYPANE_RAILWAY_TEST_CONTEXT
        ? await railwayInstallation()
        : await webhookInstallation();
      try {
        await runWithFixture(fixture);
      } finally {
        await fixture.close();
      }
    },
    { scope: 'worker', timeout: 900_000 },
  ],
});
export { expect };
