import { db } from '@/lib/db';
import { getCachedCampaign } from '@/lib/campaignCache';

/**
 * Post-event reporting: how the attendee/no-show sequences did, and which
 * accounts are worth a sales follow-up.
 *
 * Kept separate from lib/campaignCardStats.ts and the Overview funnel — those
 * answer "how is the whole campaign doing", this answers "what happened after
 * the webinar, and who should sales talk to now". Same underlying contact
 * rows, a genuinely different question.
 */

export interface PostEventStats {
  attended: number;
  noShow: number;
  /** Registered contacts — the denominator for the shared attendance rate
   *  (lib/attendanceRate.ts). Returned rather than recomputed by the client so
   *  the tile can't end up dividing by a different population than the one
   *  `attended` was counted from. */
  registered: number;
  avgWatchMinutes: number | null;
  demoRequests: number | null;
}

export async function getPostEventStats(campaignId: string): Promise<PostEventStats> {
  // Request-memoized (lib/campaignCache.ts) — on the Results page this is the
  // same full campaign row the layout and the page itself already fetched,
  // so this no longer costs its own round trip there. Still correct (if
  // slightly heavier than the old narrow select) when called on its own.
  const campaign = await getCachedCampaign(campaignId);
  const scope = {campaignId, registeredAt:{not:null}};
  const [registered, measured] = await Promise.all([
    db.contact.count({where:scope}),
    db.contact.aggregate({where:{...scope,attended:true},_count:{_all:true},_avg:{watchMinutes:true}}),
  ]);
  const attended = measured._count._all;
  const avgWatchMinutes = measured._avg.watchMinutes === null ? null : Math.round(measured._avg.watchMinutes);

  return {
    attended,
    noShow: Math.max(0, registered - attended),
    registered,
    avgWatchMinutes,
    // demoRequests has no live computation path in this app — Zoom and the
    // CRM don't carry a "requested a demo" signal, so this stays the
    // manually-set figure where one exists, honestly absent otherwise.
    demoRequests: campaign.demoRequests ?? null,
  };
}

export interface AccountEngagementRow {
  account: string;
  contactCount: number;
  attended: number;
  avgWatchMinutes: number | null;
  /** The contact to act on for this account — whoever engaged the most. */
  topContactId: string;
  topContactName: string;
  action: 'Follow up' | 'Nurture' | 'Not contacted';
  actionColor: 'success' | 'blue' | 'gray';
  intentTier: 'high' | 'medium' | 'low';
}

/** Top N accounts by attendance, for the post-event engagement table. */
export async function getAccountEngagement(campaignId: string, take = 12): Promise<AccountEngagementRow[]> {
  const limit = Math.max(1,Math.min(50,Math.floor(take)));
  type Aggregate = {account:string;contactCount:bigint;attended:bigint;avgWatchMinutes:number|null;scored:bigint;topContactId:string;topContactName:string};
  const groups = await db.$queryRaw<Aggregate[]>`WITH grouped AS (
    SELECT "account", count(*) AS "contactCount", count(*) FILTER (WHERE "attended" AND "registeredAt" IS NOT NULL) AS attended,
      avg("watchMinutes") FILTER (WHERE "attended" AND "registeredAt" IS NOT NULL) AS "avgWatchMinutes",
      count(*) FILTER (WHERE "score" IS NOT NULL) AS scored
    FROM "Contact" WHERE "campaignId" = ${campaignId} AND ("approved" OR "registeredAt" IS NOT NULL)
    GROUP BY "account" ORDER BY attended DESC, "contactCount" DESC, "account" ASC LIMIT ${limit}
  ) SELECT g.*, top.id AS "topContactId", top.name AS "topContactName" FROM grouped g CROSS JOIN LATERAL (
    SELECT "id" AS id, "name" AS name FROM "Contact" WHERE "campaignId" = ${campaignId} AND "account" = g."account" AND ("approved" OR "registeredAt" IS NOT NULL)
    ORDER BY ("attended" AND "registeredAt" IS NOT NULL) DESC, CASE WHEN "attended" AND "registeredAt" IS NOT NULL THEN COALESCE("watchMinutes",0) ELSE COALESCE("score",0) END DESC, "id" ASC LIMIT 1
  ) top ORDER BY g.attended DESC, g."contactCount" DESC, g."account" ASC`;
  return groups.map(group => {
    const attended = Number(group.attended);
    const avgWatchMinutes = group.avgWatchMinutes === null ? null : Math.round(Number(group.avgWatchMinutes));
    const hasScore = Number(group.scored)>0;
    return {account:group.account,contactCount:Number(group.contactCount),attended,avgWatchMinutes,topContactId:group.topContactId,topContactName:group.topContactName,
      action:attended?'Follow up':hasScore?'Nurture':'Not contacted',actionColor:attended?'success':hasScore?'blue':'gray',intentTier:attended>1||(avgWatchMinutes!==null&&avgWatchMinutes>=35)?'high':attended?'medium':'low'};
  });
}

/** Generates AI Executive Debrief and SDR Handoff Guide for this webinar (Pillar 3) */
export async function getPostEventDebrief(campaignId: string) {
  const { generatePostEventDebrief } = await import('@/lib/claude');
  const [campaign, stats, accounts, totalApproved] = await Promise.all([
    db.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: {
        name: true,
        description: true,
        speakerName: true,
        speakerTitle: true,
        speakers: {
          orderBy: { order: 'asc' },
          select: { name: true, title: true, company: true },
        },
      },
    }),
    getPostEventStats(campaignId),
    getAccountEngagement(campaignId, 20),
    db.contact.count({ where: { campaignId, approved: true } }),
  ]);

  return generatePostEventDebrief({
    topic: campaign.name,
    description: campaign.description,
    speakerName: campaign.speakerName,
    speakerTitle: campaign.speakerTitle,
    speakers: campaign.speakers,
    totalApproved,
    attendedCount: stats.attended,
    noShowCount: stats.noShow,
    avgWatchMinutes: stats.avgWatchMinutes,
    accounts: accounts.map((a) => ({
      account: a.account,
      attended: a.attended,
      avgWatchMinutes: a.avgWatchMinutes ?? 0,
      action: a.action,
    })),
  });
}
