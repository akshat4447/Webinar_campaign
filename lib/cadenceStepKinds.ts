/**
 * Which cadence step keys count as an "invite" (the initial pre-registration
 * touch) versus a reminder/follow-up. Shared by the dashboard KPI
 * (lib/analytics.ts) and the per-campaign card stat (lib/campaignCardStats.ts)
 * so "Invites sent" means the same sends in both places — the card used to sum
 * every sent step (invites + reminders + follow-ups) under that label while
 * the dashboard counted only these, so the same campaign showed two different
 * "Invites sent" numbers depending on which screen you looked at.
 */
export const INVITE_STEP_KEYS = ['invite', 'smsInvite', 'waInvite', 'linkedin'];
