import { getInstallation, migrateInstallation, migrateSpace } from '@storypane/db/installation';
const installation = getInstallation();
try {
  await migrateInstallation(installation.pool, installation.options.provider);
  const failed = await installation.forEachSpace(async (id) => {
    const selected = await installation.acquire(id);
    try {
      await migrateSpace(selected.db);
    } finally {
      await selected.close();
    }
  });
  if (failed.length) throw new Error(`Space migrations failed: ${failed.join(', ')}`);
  console.log('Installation and space migrations applied.');
} finally {
  await installation.pool.end();
}
