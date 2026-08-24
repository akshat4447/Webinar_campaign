// Shared validation for outbound message content — used by both the Templates
// tab (which still has {{merge}} tokens waiting to be filled in) and the
// Personalize tab (whose copy should have no tokens left at all, since Claude
// has already filled them in with the real name/company). Previously neither
// tab had a validation layer: Templates rendered ad-hoc badges with no overall
// pass/fail state, and Personalize had no content checks at all — a message
// missing the registration link or with a leftover "{{firstName}}" token
// looked exactly as "ready" as a correct one, and (see lib/cadence.ts) would
// have been sent to a real recipient exactly as broken as it looked.

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  /** True only when there are zero `error`-severity issues. Warnings alone (a
   *  long body, a spam-trigger word) don't block sending — a missing link or
   *  an unresolved token does. */
  valid: boolean;
}

const SPAM_WORDS = ['free', 'guaranteed', 'act now', 'limited time', 'click here', 'risk-free'];
const MERGE_TOKEN_RE = /\{\{\s*[\w.]+\s*\}\}/g;
const MAX_BODY_CHARS = 900;
const MAX_SUBJECT_CHARS = 60;

function linkPresent(text: string, link: string): boolean {
  if (!link) return true; // no link configured yet — not this check's job to flag that
  const bare = link.replace(/^https?:\/\//, '');
  return text.includes(link) || text.includes(bare) || /\{\{\s*link\s*\}\}/.test(text);
}

/**
 * Validates a *template* — {{merge}} tokens are expected and fine as long as
 * they're all names this app actually resolves (see knownVars in TemplatesEditor).
 */
export function validateTemplateContent(
  subject: string | null | undefined,
  body: string,
  hasSubject: boolean,
  knownVars: string[]
): ValidationResult {
  const text = (hasSubject ? `${subject ?? ''} ` : '') + body;
  const used = Array.from(new Set((text.match(MERGE_TOKEN_RE) ?? []).map((m) => m.replace(/[{}\s]/g, ''))));
  const unknown = used.filter((v) => !knownVars.includes(v));

  const hasLinkToken = /\{\{\s*link\s*\}\}/.test(text) || /https?:\/\/|lsq\.co/.test(text);

  const issues: ValidationIssue[] = [];
  if (unknown.length) issues.push({ severity: 'error', message: `Unknown variable${unknown.length > 1 ? 's' : ''}: ${unknown.map((u) => `{{${u}}}`).join(', ')}` });
  if (!hasLinkToken) issues.push({ severity: 'error', message: 'No {{link}} placeholder (or a literal link) in this template' });
  if (body.length > MAX_BODY_CHARS) issues.push({ severity: 'warning', message: `Body long — ${body.length} chars` });
  if (hasSubject && (subject ?? '').length > MAX_SUBJECT_CHARS) issues.push({ severity: 'warning', message: `Subject ${(subject ?? '').length} chars — may truncate` });
  const spam = SPAM_WORDS.filter((w) => text.toLowerCase().includes(w));
  if (spam.length) issues.push({ severity: 'warning', message: `Spam-trigger words: ${spam.join(', ')}` });

  return { issues, valid: !issues.some((i) => i.severity === 'error') };
}

/**
 * Validates a *personalized, already-rendered* message — no {{tokens}} should
 * remain (Claude is instructed not to leave any; a leftover one means the
 * personalization step actually failed for this recipient), and the real
 * registration link must be present verbatim, since that's the one thing this
 * app guarantees a personalized rewrite can never drop.
 *
 * This backs both the Personalize tab's per-recipient status badge and the
 * actual send-time guard in lib/cadence.ts — a message that fails this is
 * never sent as-is; the send falls back to the shared template instead.
 */
export function validateRenderedMessage(subject: string | null, body: string, hasChannelSubject: boolean, link: string): ValidationResult {
  const text = (hasChannelSubject ? `${subject ?? ''} ` : '') + body;
  const issues: ValidationIssue[] = [];

  const leftoverTokens = Array.from(new Set((text.match(MERGE_TOKEN_RE) ?? []).map((m) => m.replace(/[{}\s]/g, ''))));
  if (leftoverTokens.length) {
    issues.push({ severity: 'error', message: `Leftover template variable${leftoverTokens.length > 1 ? 's' : ''}: ${leftoverTokens.map((t) => `{{${t}}}`).join(', ')}` });
  }
  if (!linkPresent(text, link)) {
    issues.push({ severity: 'error', message: 'Registration link is missing from this message' });
  }
  if (!body.trim()) {
    issues.push({ severity: 'error', message: 'Message body is empty' });
  }
  if (body.length > MAX_BODY_CHARS) issues.push({ severity: 'warning', message: `Body long — ${body.length} chars` });
  if (hasChannelSubject && (subject ?? '').length > MAX_SUBJECT_CHARS) issues.push({ severity: 'warning', message: `Subject ${(subject ?? '').length} chars — may truncate` });
  const spam = SPAM_WORDS.filter((w) => text.toLowerCase().includes(w));
  if (spam.length) issues.push({ severity: 'warning', message: `Spam-trigger words: ${spam.join(', ')}` });

  return { issues, valid: !issues.some((i) => i.severity === 'error') };
}
