import { getLists, emptyStaticList } from '../lib/leadsquared';
import { db } from '../lib/db';

async function main() {
  console.log('--- Step 1: Scanning LeadSquared tenant for auto-created lists ---');
  const allLists = await getLists();
  console.log(`Retrieved ${allLists.length} total lists from LeadSquared.`);

  const targetLists = allLists.filter((l) => {
    const nameMatch = l.ListName.includes('— Webinar Campaign Agent') || l.ListName === '__AGENT_PROBE_DELETE_TEST__';
    const descMatch = typeof l.ListDescription === 'string' && l.ListDescription.includes('Auto-created by Webinar Campaign Agent');
    return nameMatch || descMatch;
  });

  console.log(`\nFound ${targetLists.length} auto-created lists to clean safely:`);
  for (const l of targetLists) {
    console.log(`- [${l.ListId}] "${l.ListName}" (Current members: ${l.MemberCount})`);
  }

  // Safety check: ensure no legitimate list was mistakenly matched
  for (const l of targetLists) {
    const isSafe = l.ListName.includes('— Webinar Campaign Agent') ||
      l.ListName === '__AGENT_PROBE_DELETE_TEST__' ||
      (l.ListDescription && l.ListDescription.includes('Auto-created by Webinar Campaign Agent'));
    if (!isSafe) {
      throw new Error(`CRITICAL ABORT: List "${l.ListName}" did not pass safety check!`);
    }
  }

  console.log('\n--- Step 2: Emptying auto-created lists via LeadSquared API ---');
  const emptiedSummary: Array<{ id: string; name: string; beforeMembers: number }> = [];

  for (const l of targetLists) {
    console.log(`Emptying list [${l.ListId}] "${l.ListName}"...`);
    try {
      await emptyStaticList(l.ListId);
      console.log(`  ✓ Emptied successfully`);
      emptiedSummary.push({ id: l.ListId, name: l.ListName, beforeMembers: l.MemberCount });
    } catch (err) {
      console.error(`  ✗ Failed to empty list [${l.ListId}]:`, err);
    }
  }

  console.log('\n--- Step 3: Unlinking campaigns in local SQLite database ---');
  const targetIds = targetLists.map((l) => l.ListId);
  const linkedCampaigns = await db.campaign.findMany({
    where: {
      lsqListId: { in: targetIds },
    },
    select: {
      id: true,
      name: true,
      lsqListId: true,
    },
  });

  console.log(`Found ${linkedCampaigns.length} campaigns locally referencing these auto-created lists:`);
  for (const c of linkedCampaigns) {
    console.log(`- Campaign [${c.id}] "${c.name}" (lsqListId was ${c.lsqListId})`);
  }

  if (linkedCampaigns.length > 0) {
    const updateResult = await db.campaign.updateMany({
      where: {
        lsqListId: { in: targetIds },
      },
      data: {
        lsqListId: null,
      },
    });
    console.log(`  ✓ Updated ${updateResult.count} campaigns: set lsqListId = null.`);
  }

  console.log('\n--- Step 4: Verification pass ---');
  const verifyLists = await getLists();
  const verifyTargets = verifyLists.filter((l) => targetIds.includes(l.ListId));
  console.log('Member count after emptying:');
  for (const l of verifyTargets) {
    console.log(`- [${l.ListId}] "${l.ListName}": ${l.MemberCount} members`);
  }

  console.log('\n============================================================');
  console.log('CLEANUP COMPLETE:');
  console.log(`- Total auto-created lists emptied: ${emptiedSummary.length}`);
  console.log(`- Total campaigns unlinked: ${linkedCampaigns.length}`);
  console.log('============================================================\n');
}

main().catch((err) => {
  console.error('Fatal cleanup error:', err);
  process.exit(1);
});
