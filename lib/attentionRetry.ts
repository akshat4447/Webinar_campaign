// Pure. A "Retry" on an item that needs attention must retry the thing that went wrong. Until now it re-ran failed message sends
// for every item, and then marked the item resolved whether or not that had anything to do with it.

export type RetryPlan =
  | { kind: 'sends' }
  | { kind: 'crm-sync' }
  | { kind: 'elsewhere'; where: string; href: (campaignId: string) => string };

const tab = (where: string, path: string): RetryPlan => ({ kind: 'elsewhere', where, href: (id) => `/campaigns/${id}/${path}` });

/** What retrying an item should do, from the title its author gave it. */
export function retryPlanFor(title: string): RetryPlan {
  if (/^LeadSquared lead sync failed$/i.test(title)) return { kind: 'crm-sync' };
  if (/\bsend failed for\b/i.test(title) || /draft for .+ failed validation/i.test(title)) return { kind: 'sends' };
  if (/scoring|enrichment|apollo/i.test(title)) return tab('Audience', 'audience');
  if (/personalization/i.test(title)) return tab('Messaging', 'messaging');
  if (/linkedin/i.test(title)) return { kind: 'elsewhere', where: 'LinkedIn Outreach', href: (id) => `/linkedin?event=${id}` };
  if (/zoom|activity push/i.test(title)) return tab('Registration', 'registration');
  return { kind: 'sends' };
}

/** The button's label: it says where the retry happens when that is not here. */
export function retryLabel(plan: RetryPlan): string {
  return plan.kind === 'elsewhere' ? `Retry In ${plan.where}` : 'Retry';
}
