// Event Registration Forms service.
//
// Two hard LinkedIn rules shape this module:
//  1. A form can ONLY be attached at the moment of event creation — never
//     edited or swapped afterwards. So we resolve an APPROVED form BEFORE any
//     event call happens.
//  2. Forms go through LinkedIn review after creation; until status is
//     APPROVED the orchestrator refuses to proceed (it parks the campaign in
//     form_pending_review instead of burning an API call that would fail).
//
// NOTE on review submission: LinkedIn moves freshly created forms into review
// automatically; the exact submit/review endpoint has shifted between doc
// versions, so we poll status rather than calling an unverifiable action.
import { createHash } from 'crypto';
import { restRequest, responseIdFromHeaders, getLinkedinMode } from './client';

export type FormStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';

export function normalizeFormStatus(raw: string | null | undefined): FormStatus {
  const v = (raw ?? '').toUpperCase();
  if (v.includes('APPROV')) return 'APPROVED';
  if (v.includes('REJECT') || v.includes('DENIED')) return 'REJECTED';
  if (v.includes('REVIEW') || v.includes('PENDING') || v.includes('SUBMIT')) return 'PENDING';
  return 'DRAFT';
}

// Fixed internal name so repeat runs across campaigns reuse one approved form
// per Page instead of piling up near-identical forms in review queues.
const INTERNAL_FORM_NAME = 'webinar-campaign-agent-default';

export function buildRegistrationFormPayload(displayName: string, description: string) {
  return {
    name: INTERNAL_FORM_NAME,
    displayName,
    description,
    configuration: {
      // FULL_NAME + EMAIL_ADDRESS are what Contact/LeadSquared need; anything
      // more costs conversion, so custom questions stay minimal.
      dataPermissions: ['FULL_NAME', 'EMAIL_ADDRESS'],
      customQuestions: [
        { question: { questionType: 'SHORT_ANSWER', label: "What's your job title?" } },
        { question: { questionType: 'SHORT_ANSWER', label: 'Which company are you with?' } },
      ],
    },
  };
}

export interface EnsureFormResult {
  formUrn: string;
  status: FormStatus;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Returns an APPROVED form for the Page — reusing a previously approved one
// when it exists, otherwise creating it and polling briefly for approval.
 * A non-APPROVED result is a normal state (review takes time), not an error.
 */
export async function ensureApprovedRegistrationForm(args: {
  organizationUrn: string;
  displayName: string;
  description: string;
}): Promise<EnsureFormResult> {
  if ((await getLinkedinMode()) !== 'live') {
    // Deterministic per-Page sandbox URN so repeated dry-runs look stable.
    const hash = createHash('sha1').update(`${args.organizationUrn}:${INTERNAL_FORM_NAME}`).digest('hex').slice(0, 10);
    return { formUrn: `urn:li:registrationForm:sbx${hash}`, status: 'APPROVED' };
  }

  // Reuse pass — tolerate a failing/changed finder by treating it as "none".
  let existingUrn: string | null = null;
  let existingStatus: FormStatus = 'DRAFT';
  try {
    const list = await restRequest(`/registrationForms?q=owner&owner=${encodeURIComponent(args.organizationUrn)}&count=50`);
    const elements = (list.json as { elements?: Array<Record<string, unknown>> } | null)?.elements ?? [];
    const mine = elements.find((e) => e.name === INTERNAL_FORM_NAME);
    if (mine) {
      existingUrn = typeof mine.registrationForm === 'string' ? mine.registrationForm : mine.id != null ? `urn:li:registrationForm:${mine.id}` : null;
      existingStatus = normalizeFormStatus(typeof mine.status === 'string' ? mine.status : null);
    }
  } catch {
    /* fall through to create */
  }

  if (existingUrn && existingStatus === 'APPROVED') return { formUrn: existingUrn, status: 'APPROVED' };

  const urn =
    existingUrn ??
    await (async () => {
      const res = await restRequest('/registrationForms', { method: 'POST', body: buildRegistrationFormPayload(args.displayName, args.description) });
      const id = responseIdFromHeaders(res.headers);
      if (!id) throw new Error(`Registration form created but no id header returned: ${res.text.slice(0, 200)}`);
      return `urn:li:registrationForm:${id.replace(/^urn:li:registrationForm:/, '')}`;
    })();

  // Short poll: approval often lands quickly; when it doesn't, returning
  // PENDING is correct behavior (the UI explains and the run resumes later).
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(1500);
    try {
      const cur = await restRequest(`/registrationForms/${encodeURIComponent(urn)}`);
      const status = normalizeFormStatus(typeof (cur.json as { status?: string } | null)?.status === 'string' ? (cur.json as { status: string }).status : null);
      if (status === 'APPROVED' || status === 'REJECTED') return { formUrn: urn, status };
      existingStatus = status;
    } catch {
      break;
    }
  }
  return { formUrn: urn, status: existingStatus === 'APPROVED' ? 'APPROVED' : 'PENDING' };
}