// The build this server is running — the app compares it with its own to
// notice a new deploy.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { id: process.env.NEXT_PUBLIC_BUILD_ID ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
