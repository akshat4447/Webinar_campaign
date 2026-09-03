import { Card } from '@/components/ui/Card';
import { NavButton } from '@/components/ui/NavButton';
import { db } from '@/lib/db';
import { LeadImportCard } from './LeadImportCard';
import { CampaignDetailsForm } from './CampaignDetailsForm';
import { EnrichmentCard } from './EnrichmentCard';
import { LinkedInPublishCard } from './LinkedInPublishCard';
import { getEnrichmentStats } from '@/lib/actions/enrichment';
import { getServerNow } from '@/lib/actions/clock';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { linkedinMode } from '@/lib/linkedin/client';

export default async function SetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [campaign, activityLog, enrichmentStats, serverNow, contactCount, scoredCount, orgName, orgUrn] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id } }),
    db.activityLogEntry.findMany({ where: { campaignId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    getEnrichmentStats(id),
    getServerNow(),
    db.contact.count({ where: { campaignId: id } }),
    db.contact.count({ where: { campaignId: id, score: { not: null } } }),
    resolveIntegrationField('linkedin', 'organizationName'),
    resolveIntegrationField('linkedin', 'organizationUrn'),
  ]);
  const mode = linkedinMode();

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <CampaignDetailsForm campaign={campaign} serverNow={serverNow} />
          <LeadImportCard campaignId={id} existingContactCount={contactCount} existingScoredCount={scoredCount} />
          <EnrichmentCard campaignId={id} stats={enrichmentStats} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <LinkedInPublishCard
            campaignId={id}
            name={campaign.name}
            description={campaign.description}
            dateDisplay={campaign.date}
            zoomLink={campaign.zoomLink}
            organizationLabel={orgName ?? orgUrn ?? null}
            mode={mode}
            status={campaign.linkedinEventStatus}
            error={campaign.linkedinEventError}
            eventUrn={campaign.linkedinEventUrn}
          />

          <Card>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent-500)', flexShrink: 0 }} />
              Agent activity log
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {activityLog.length === 0 && <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)' }}>No activity yet — import contacts to get started.</div>}
              {activityLog.map((log) => (
                <div key={log.id} style={{ display: 'flex', gap: 10 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: log.dot, marginTop: 6, flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n70)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{log.text}</div>
                    <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginTop: 1 }}>{log.createdAt.toLocaleTimeString('en-GB', { hour12: false })}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--accent-500)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 'var(--fs-label-2)', fontWeight: 700, color: '#fff' }}>
                AI
              </div>
              <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)' }}>Ready to score audience</div>
            </div>
            <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', lineHeight: 1.55, marginBottom: 14, overflowWrap: 'anywhere' }}>
              Claude will match personas by title, function and seniority across all imported accounts, then score relevance to
              this webinar&apos;s topic.
            </div>
            <NavButton href={`/campaigns/${id}/audience`} fullWidth>
              Run audience scoring
            </NavButton>
          </Card>
        </div>
      </div>
    </main>
  );
}
