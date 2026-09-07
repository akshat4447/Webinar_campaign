import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { processDueSends } from '@/lib/cadence';

export const dynamic = 'force-dynamic';

/**
 * Cadence Cron Endpoint
 *
 * Designed for serverless and external schedulers (Vercel Cron, GitHub Actions,
 * AWS EventBridge, Render Cron, or cron-job.org).
 *
 * Protected via CRON_SECRET:
 * Headers: "Authorization: Bearer <CRON_SECRET>"
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const running = await db.campaign.findMany({
      where: { cadenceStatus: 'running' },
      select: { id: true, name: true },
    });

    let totalProcessed = 0;
    let totalSent = 0;
    let totalFailed = 0;

    for (const campaign of running) {
      const result = await processDueSends(campaign.id);
      totalProcessed += result.processed;
      totalSent += result.sent;
      totalFailed += result.failed;
    }

    return NextResponse.json({
      ok: true,
      checkedCampaigns: running.length,
      processed: totalProcessed,
      sent: totalSent,
      failed: totalFailed,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Cron cadence tick failed:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
