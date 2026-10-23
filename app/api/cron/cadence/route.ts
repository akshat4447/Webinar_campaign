import { NextResponse } from 'next/server';
import { runWorkerTick } from '@/lib/workerTick';
import { cronAuthorization } from '@/lib/cronAuth';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function GET(request: Request) {
  const authorization = cronAuthorization(request);
  if (authorization !== 'authorized') {
    return NextResponse.json({ ok: false, error: authorization === 'unconfigured' ? 'Scheduler is not configured.' : 'Unauthorized' }, {
      status: authorization === 'unconfigured' ? 503 : 401,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  try {
    const result = await runWorkerTick();
    return NextResponse.json(result, { status: result.ok ? 200 : 500, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[worker] scheduled tick failed', error);
    return NextResponse.json({ ok: false, error: 'Worker tick failed.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
