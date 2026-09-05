import { db } from '@/lib/db';

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
  avgWatchMinutes: number | null;
  demoRequests: number | null;
}

export async function getPostEventStats(campaignId: string): Promise<PostEventStats> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { demoRequests: true } });
  const approved = await db.contact.findMany({
    where: { campaignId, approved: true },
    select: { attended: true, watchMinutes: true },
  });
  const attendedRows = approved.filter((c) => c.attended);
  const withWatch = attendedRows.filter((c) => c.watchMinutes !== null && c.watchMinutes! > 0);
  const avgWatchMinutes =
    withWatch.length > 0 ? Math.round(withWatch.reduce((sum, c) => sum + (c.watchMinutes ?? 0), 0) / withWatch.length) : null;

  return {
    attended: attendedRows.length,
    noShow: approved.length - attendedRows.length,
    avgWatchMinutes,
    // demoRequests has no live computation path in this app — Zoom and the
    // CRM don't carry a "requested a demo" signal, so this stays the
    // manually-set figure where one exists, honestly absent otherwise.
    demoRequests: campaign.demoRequests ?? null,
  };
}

export interface AccountEngagementRow {
  account: string;
  contactIds: string[];
  contactCount: number;
  attended: number;
  avgWatchMinutes: number | null;
  /** The contact to act on for this account — whoever engaged the most. */
  topContactId: string;
  topContactName: string;
  action: 'Follow up' | 'Nurture' | 'Not contacted';
  actionColor: 'success' | 'blue' | 'gray';
}

/** Top N accounts by attendance, for the post-event engagement table. */
export async function getAccountEngagement(campaignId: string, take = 12): Promise<AccountEngagementRow[]> {
  const contacts = await db.contact.findMany({
    where: { campaignId, approved: true },
    select: { id: true, name: true, account: true, attended: true, watchMinutes: true, score: true },
  });

  const byAccount = new Map<string, typeof contacts>();
  for (const c of contacts) byAccount.set(c.account, [...(byAccount.get(c.account) ?? []), c]);

  const rows: AccountEngagementRow[] = [...byAccount.entries()].map(([account, cs]) => {
    const attendedRows = cs.filter((c) => c.attended);
    const withWatch = attendedRows.filter((c) => (c.watchMinutes ?? 0) > 0);
    const avgWatchMinutes = withWatch.length > 0 ? Math.round(withWatch.reduce((s, c) => s + (c.watchMinutes ?? 0), 0) / withWatch.length) : null;
    // The contact to act on: the longest-watching attendee if anyone showed
    // up, otherwise whoever scored highest — sales still needs a name to call.
    const top = attendedRows.length > 0
      ? attendedRows.reduce((a, b) => ((a.watchMinutes ?? 0) >= (b.watchMinutes ?? 0) ? a : b))
      : cs.reduce((a, b) => ((a.score ?? 0) >= (b.score ?? 0) ? a : b));

    return {
      account,
      contactIds: cs.map((c) => c.id),
      contactCount: cs.length,
      attended: attendedRows.length,
      avgWatchMinutes,
      topContactId: top.id,
      topContactName: top.name,
      action: attendedRows.length > 0 ? 'Follow up' : cs.some((c) => c.score !== null) ? 'Nurture' : 'Not contacted',
      actionColor: attendedRows.length > 0 ? 'success' : cs.some((c) => c.score !== null) ? 'blue' : 'gray',
    };
  });

  return rows.sort((a, b) => b.attended - a.attended || b.contactCount - a.contactCount).slice(0, take);
}
