import { createServices } from '../../../lib/context';

export const dynamic = 'force-dynamic';
export async function GET() {
  let services: ReturnType<typeof createServices> | undefined;
  try {
    services = createServices();
    await services.installation.assertProvider();
    const failed = await services.installation.forEachSpace(async (id) => {
      const selected = await services!.installation.acquire(id);
      try {
        await selected.db.query(
          "SELECT 1 FROM storypane_migrations WHERE name='025_space_database'",
        );
      } finally {
        await selected.close();
      }
    });
    if (failed.length)
      return Response.json(
        { ready: true, degraded: true, unavailableSpaces: failed.length },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    return Response.json({ ready: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      { ready: false },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    await services?.close();
  }
}
