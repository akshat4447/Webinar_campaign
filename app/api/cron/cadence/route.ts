import { NextResponse } from 'next/server';
import { runWorkerTick } from '@/lib/workerTick';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function GET() {
  try {
    const result = await runWorkerTick();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Worker tick failed.' }, { status: 500 });
  }
}
