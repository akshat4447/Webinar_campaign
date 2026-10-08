import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ok:true}, {headers:{'Cache-Control':'no-store'}});
  } catch {
    return NextResponse.json({ok:false}, {status:503,headers:{'Cache-Control':'no-store'}});
  }
}
