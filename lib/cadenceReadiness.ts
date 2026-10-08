// Readiness verdicts for the Templates and Personalize tabs — the "green
// status" an operator can trust. Green means the stage is genuinely send-safe:
//
//   Templates   every ENABLED step has a template whose content passes its
//               own channel rules (link present, SMS segment budget, etc.)
//   Personalize everything above holds AND no enabled step has an invalid
//               personalized copy waiting; missing rows are fine (the shared
//               template is a valid fallback by design).
import { db } from '@/lib/db';
import { normalizeChannel } from '@/lib/channels';
import { validateTemplateContentForChannel, validateRenderedMessageForChannel } from '@/lib/messageValidation';
import { resolveStepTemplates } from '@/lib/messageTemplates';
import { KNOWN_MERGE_VARS } from '@/lib/mergeFields';
export { KNOWN_MERGE_VARS };

export interface Readiness {
  ok: boolean;
  problems: string[];
}

/**
 * Enabled steps paired with their resolved template — one batched
 * resolution (resolveStepTemplates) shared by computeTemplatesReadiness and
 * computePersonalizeReadiness, which both need this same pairing and used to
 * each recompute it (each with its own per-step resolveStepTemplate loop).
 */
async function stepsWithTemplates(campaignId: string) {
  const steps = await db.cadenceStep.findMany({ where: { campaignId, enabled: true, removedAt: null } });
  const resolved = await resolveStepTemplates(campaignId, steps.map((s) => s.key));
  return steps.map((step) => ({ step, template: resolved.get(step.key) ?? null }));
}

function templatesReadinessFrom(pairs: Awaited<ReturnType<typeof stepsWithTemplates>>): Readiness {
  const problems: string[] = [];
  for (const { step, template } of pairs) {
    if (!template || template.hidden) {
      problems.push(`Step "${step.title || step.key}" (${step.channel}): No valid template assigned`);
      continue;
    }
    const v = validateTemplateContentForChannel(template.subject, template.body, template.hasSubject, KNOWN_MERGE_VARS, template.channel);
    if (!v.valid) {
      problems.push(`${template.label}: ${v.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; ')}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

export async function computeTemplatesReadiness(campaignId: string): Promise<Readiness> {
  return templatesReadinessFrom(await stepsWithTemplates(campaignId));
}

export async function computePersonalizeReadiness(campaignId: string): Promise<Readiness & { approvedCount: number; generatedTotal: number }> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { registrationLink: true, zoomLink: true } });
  const allPairs = await stepsWithTemplates(campaignId);
  const base = templatesReadinessFrom(allPairs);
  if (!base.ok) return { ...base, approvedCount: 0, generatedTotal: 0 };

  const approvedCount = await db.contact.count({ where: { campaignId, approved: true } });
  const pairs = allPairs.filter(
    (pair): pair is { step: (typeof allPairs)[number]['step']; template: NonNullable<typeof pair.template> } =>
      !!pair.template && !pair.template.hidden
  );
  const problems: string[] = [];
  let generatedTotal = 0;

  // One query for every step, selecting only the three fields validation reads.
  // This was a findMany per step with no `select`, so a 15-step campaign with
  // 5,000 contacts pulled ~75,000 full rows — every subject and body, tens of
  // MB — into memory on every render of the Messaging page.
  const link = campaign.registrationLink || campaign.zoomLink || '';
  const stepKeys = pairs.map((p) => p.step.key);
  const pairByKey=new Map(pairs.map(pair=>[pair.step.key,pair]));
  const invalidByStep=new Map<string,number>();
  let cursor:string|undefined;
  while(stepKeys.length){
    const batch=await db.personalizedMessage.findMany({where:{campaignId,stepKey:{in:stepKeys}},select:{id:true,stepKey:true,subject:true,body:true},orderBy:{id:'asc'},take:500,...(cursor?{cursor:{id:cursor},skip:1}:{})});
    generatedTotal+=batch.length;
    for(const message of batch){const pair=pairByKey.get(message.stepKey);if(!pair)continue;const channel=normalizeChannel(pair.template.channel);if(!validateRenderedMessageForChannel(message.subject,message.body,channel==='email',link,channel).valid)invalidByStep.set(message.stepKey,(invalidByStep.get(message.stepKey)||0)+1);}
    if(batch.length<500)break;
    cursor=batch[batch.length-1].id;
  }
  for(const {step,template} of pairs){const invalid=invalidByStep.get(step.key)||0;if(invalid)problems.push(`${template.label}: ${invalid} personalized cop${invalid===1?'y':'ies'} failed validation — they fall back to the template until fixed`);}

  return { ok: problems.length === 0, problems, approvedCount, generatedTotal };
}