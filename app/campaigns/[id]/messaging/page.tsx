import { db } from '@/lib/db';
import { PersonalizeClient } from './PersonalizeClient';
import { PERSONALIZABLE_STEPS, CONFIRM_THRESHOLD, isLinkStale } from '@/lib/personalization';
import { resolveStepTemplate } from '@/lib/messageTemplates';
import { normalizeChannel } from '@/lib/channels';
import { computePersonalizeReadiness } from '@/lib/cadenceReadiness';
import { Badge } from '@/components/ui/Badge';

export default async function PersonalizePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string }> }) {
  const { id } = await params;
  const { step: stepParam } = await searchParams;

  const [campaign, templates, approvedContacts] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id } }),
    // Resolve each personalizable step through the shared library, the same
    // way the send path does. Reading the legacy per-campaign table showed
    // "no templates on this campaign yet" for every campaign created after
    // messages moved to the library.
    Promise.all(
      PERSONALIZABLE_STEPS.map(async (key) => ({ key, resolved: await resolveStepTemplate(id, key) }))
    ),
    db.contact.findMany({
      where: { campaignId: id, approved: true },
      orderBy: [{ score: 'desc' }, { name: 'asc' }],
    }),
  ]);

  const available = templates
    .filter((t) => t.resolved && !t.resolved.hidden)
    .map((t) => ({
      key: t.key,
      label: t.resolved!.label,
      channel: t.resolved!.channel,
      hasSubject: t.resolved!.hasSubject,
      subject: t.resolved!.subject,
      body: t.resolved!.body,
    }));

  if (available.length === 0) {
    return (
      <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
        <div style={{ textAlign: 'center', color: 'var(--n60)', fontSize: 'var(--fs-label-1)', marginTop: 48 }}>
          No messages available for this campaign&apos;s steps — check the Templates library.
        </div>
      </main>
    );
  }

  const activeStep = available.find((t) => t.key === stepParam) ?? available[0];

  const messages = await db.personalizedMessage.findMany({
    where: { campaignId: id, stepKey: activeStep.key },
  });
  const byContact = new Map(messages.map((m) => [m.contactId, m]));

  // Counts per step so the step picker can show coverage at a glance.
  const grouped = await db.personalizedMessage.groupBy({ by: ['stepKey'], where: { campaignId: id }, _count: true });
  const countByStep = Object.fromEntries(grouped.map((g) => [g.stepKey, g._count]));

  const currentLink = campaign.registrationLink || campaign.zoomLink || '';
  const readiness = await computePersonalizeReadiness(id);

  const rows = approvedContacts.map((c) => {
    const m = byContact.get(c.id);
    return {
      contactId: c.id,
      name: c.name,
      title: c.title,
      account: c.account,
      seniority: c.seniority,
      function: c.function,
      vertical: c.vertical,
      score: c.score,
      personaNote: c.personaNote,
      message: m
        ? {
            id: m.id,
            subject: m.subject,
            body: m.body,
            rationale: m.rationale,
            status: m.status,
            linkStale: isLinkStale(m.linkUsed, currentLink),
          }
        : null,
    };
  });

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <Badge
          color={readiness.ok ? 'success' : 'warning'}
          text={
            readiness.ok
              ? campaign.msgMode === 'templatized'
                ? `Templates ready — ${available.length} step(s) auto-merge on send`
                : `Personalization ready — ${readiness.generatedTotal} draft(s) across ${available.length} steps`
              : `${readiness.problems.length} issue(s) to fix`
          }
          dot
        />
        {!readiness.ok && (
          <span style={{ fontSize: 'var(--fs-label-1)', color: 'var(--warning-700)', overflowWrap: 'anywhere' }}>{readiness.problems.join(' · ')}</span>
        )}
      </div>
      <PersonalizeClient
        // Remount on step change: the editor holds the recipient copy in local
        // state, and a soft navigation between steps swaps the props without
        // reseeding it — which would show the previous step's messages.
        key={activeStep.key}
        campaignId={id}
        campaignName={campaign.name}
        campaignDate={campaign.date}
        speakerName={campaign.speakerName}
        hasDescription={!!campaign.description}
        steps={available.map((t) => ({ key: t.key, label: t.label, channel: t.channel, count: countByStep[t.key] ?? 0 }))}
        activeStepKey={activeStep.key}
        activeStepLabel={activeStep.label}
        activeChannel={normalizeChannel(activeStep.channel)}
        templateSubject={activeStep.hasSubject ? activeStep.subject : null}
        templateBody={activeStep.body}
        msgMode={campaign.msgMode === 'templatized' ? 'templatized' : 'ai'}
        rows={rows}
        currentLink={currentLink}
        personalizationPrompt={campaign.personalizationPrompt}
        brief={campaign.brief ?? ''}
        aiInstructions={campaign.aiInstructions ?? ''}
        confirmThreshold={CONFIRM_THRESHOLD}
      />
    </main>
  );
}
