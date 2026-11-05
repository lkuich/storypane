import { createServices } from '../../../lib/context';

export const dynamic = 'force-dynamic';
export async function GET() {
  let services: ReturnType<typeof createServices> | undefined;
  try {
    services = createServices();
    await services.db.query('SELECT 1 FROM storypane_migrations LIMIT 1');
    return Response.json({ ready: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      { ready: false },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    await services?.db.end();
  }
}
