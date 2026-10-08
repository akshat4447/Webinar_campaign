import { db } from '@/lib/db';
import { Prisma } from '@/lib/generated/prisma/client';
import { attendanceRate } from '@/lib/attendanceRate';

export async function getOverviewData(campaignId: string) {
  const [counts] = await db.$queryRaw<Array<{total:number;enriched:number;scored:number;approvedScored:number;approved:number;registered:number;attended:number;synced:number;invited:number}>>`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE "enrichedAt" IS NOT NULL)::int AS enriched,
      count(*) FILTER (WHERE score IS NOT NULL)::int AS scored,
      count(*) FILTER (WHERE approved)::int AS approved,
      count(*) FILTER (WHERE approved AND score IS NOT NULL)::int AS "approvedScored",
      count(*) FILTER (WHERE "registeredAt" IS NOT NULL)::int AS registered,
      count(*) FILTER (WHERE attended)::int AS attended,
      count(*) FILTER (WHERE "lsqLeadId" IS NOT NULL)::int AS synced,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "CadenceSend" s WHERE s."contactId"=c.id AND s."campaignId"=${campaignId} AND s."stepKey"='invite' AND s.status='sent'))::int AS invited
    FROM "Contact" c WHERE "campaignId"=${campaignId}`;
  const [scoreBands, groups, accounts, learningGroups] = await Promise.all([
    db.$queryRaw<Array<{label:string;contacts:number;approved:number;registered:number;attended:number}>>`
      SELECT CASE WHEN score>=90 THEN '90–100' WHEN score>=75 THEN '75–89' WHEN score>=60 THEN '60–74' ELSE 'Below 60' END AS label,
      count(*)::int AS contacts,count(*) FILTER(WHERE approved)::int AS approved,count(*) FILTER(WHERE "registeredAt" IS NOT NULL)::int AS registered,count(*) FILTER(WHERE attended)::int AS attended
      FROM "Contact" WHERE "campaignId"=${campaignId} AND score IS NOT NULL GROUP BY 1 ORDER BY max(score) DESC`,
    db.$queryRaw<Array<{kind:string;label:string;count:number;pct:number}>>`
      WITH groups AS (
        SELECT 'persona' AS kind,seniority||' · '||"function" AS label,count(*)::int AS count FROM "Contact" WHERE "campaignId"=${campaignId} GROUP BY 2
        UNION ALL SELECT 'source',source,count(*)::int FROM "Contact" WHERE "campaignId"=${campaignId} GROUP BY 2
        UNION ALL SELECT 'vertical',vertical,count(*)::int FROM "Contact" WHERE "campaignId"=${campaignId} GROUP BY 2
        UNION ALL SELECT 'scoreband',CASE WHEN coalesce(score,0)>=90 THEN '90–100 (Excellent)' WHEN coalesce(score,0)>=75 THEN '75–89 (Strong)' WHEN coalesce(score,0)>=60 THEN '60–74 (Moderate)' ELSE 'Below 60 (Low)' END,count(*)::int FROM "Contact" WHERE "campaignId"=${campaignId} GROUP BY 2
      ), ranked AS (SELECT *,row_number() OVER(PARTITION BY kind ORDER BY count DESC,label) AS rank, max(count) OVER(PARTITION BY kind) AS maximum FROM groups)
      SELECT kind,label,count,round(100.0*count/maximum)::int AS pct FROM ranked WHERE rank<=20 ORDER BY kind,count DESC,label`,
    db.$queryRaw<Array<{account:string;contactCount:number;approved:number;attended:number;topScore:number}>>`
      SELECT account,count(*)::int AS "contactCount",count(*) FILTER(WHERE approved)::int AS approved,count(*) FILTER(WHERE attended)::int AS attended,greatest(0,coalesce(max(score),0))::int AS "topScore"
      FROM "Contact" WHERE "campaignId"=${campaignId} GROUP BY account ORDER BY "topScore" DESC,"contactCount" DESC,account LIMIT 12`,
    db.$queryRaw<Array<{kind:string;label:string;total:number;rate:number}>>`
      WITH groups AS (
        SELECT 'persona' AS kind,seniority||'-level, '||"function" AS label,count(*)::int AS total,round(100.0*count(*) FILTER(WHERE approved)/count(*))::int AS rate FROM "Contact" WHERE "campaignId"=${campaignId} AND score IS NOT NULL GROUP BY 2 HAVING count(*)>=2
        UNION ALL SELECT 'source',source,count(*)::int,round(100.0*count(*) FILTER(WHERE approved)/count(*))::int FROM "Contact" WHERE "campaignId"=${campaignId} AND score IS NOT NULL GROUP BY 2 HAVING count(*)>=2
      ), ranked AS (SELECT *,row_number() OVER(PARTITION BY kind ORDER BY rate DESC,total DESC,label) AS rank FROM groups)
      SELECT kind,label,total,rate FROM ranked WHERE rank=1`,
  ]);
  const filters: Record<string,Prisma.ContactWhereInput> = {
    Imported:{}, Enriched:{enrichedAt:{not:null}}, Scored:{score:{not:null}}, Approved:{approved:true},
    Invited:{cadenceSends:{some:{stepKey:'invite',status:'sent'}}}, Registered:{registeredAt:{not:null}}, Attended:{attended:true}, 'CRM synced':{lsqLeadId:{not:null}},
  };
  const stageCounts: Record<string,number>={Imported:counts.total,Enriched:counts.enriched,Scored:counts.scored,Approved:counts.approved,Invited:counts.invited,Registered:counts.registered,Attended:counts.attended,'CRM synced':counts.synced};
  const previews=await Promise.all(Object.entries(filters).map(async([label,filter])=>[label,await db.contact.findMany({where:{campaignId,...filter},take:50,orderBy:[{score:{sort:'desc',nulls:'last'}},{id:'asc'}],select:{name:true,account:true,title:true,score:true}})] as const));
  const drawers=Object.fromEntries(previews.map(([label,contacts])=>[label,{title:label,subtitle:`${stageCounts[label]} of ${counts.total} contacts — the records behind this stage`,columns:['Contact','Account','Title','Score'],rows:contacts.map(c=>[c.name,c.account,c.title,c.score===null?'—':String(c.score)]),notes:stageCounts[label]>50?[`Showing the top 50 of ${stageCounts[label]} by score — search and paginate the Audience tab for the full list.`]:undefined}]));
  drawers['Invited (invite step)']=drawers.Invited;
  return {counts,scoreBands:scoreBands.map(b=>({...b,approvalRate:Math.round(b.approved/b.contacts*100),attendanceRate:attendanceRate(b.attended,b.registered)})),breakdownData:{persona:groups.filter(g=>g.kind==='persona'),source:groups.filter(g=>g.kind==='source'),vertical:groups.filter(g=>g.kind==='vertical'),scoreband:groups.filter(g=>g.kind==='scoreband')},accountBreakdown:accounts.map(a=>({...a,action:a.attended?'Attended':a.approved?'Approved':'Not contacted',actionColor:a.attended?'success':a.approved?'blue':'gray'})),learningGroups,stageCounts,drawers};
}
