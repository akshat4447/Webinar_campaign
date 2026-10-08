import type { TestResult } from '@/lib/integrationConfig';

export type IntegrationStatus = 'connected' | 'setup' | 'error';

/**
 * One definition of "is this service working" shared by the summary tiles on the page and the badge on each
 * card, so they cannot disagree. The badge reflects the last genuine test result (or, for Zoom/LinkedIn, a
 * completed OAuth connection) rather than static demo data: "needs setup" is more honest than a green badge
 * nothing has proven.
 */
export function integrationStatus(opts: {
  id: string;
  testResult: TestResult | null;
  /** Zoom / LinkedIn: an OAuth or server-to-server connection exists. */
  oauthConnected?: boolean;
  /** SMS & WhatsApp: derived from each direct channel's last test. */
  messagingBadge?: { color: string; text: string } | null;
}): IntegrationStatus {
  if (opts.id === 'messaging') {
    const color = opts.messagingBadge?.color;
    return color === 'success' ? 'connected' : color === 'error' ? 'error' : 'setup';
  }
  if (opts.testResult) return opts.testResult.ok ? 'connected' : 'error';
  if (opts.oauthConnected) return 'connected';
  return 'setup';
}

export const STATUS_BADGE: Record<IntegrationStatus, { color: string; text: string }> = {
  connected: { color: 'success', text: 'Connected' },
  setup: { color: 'gray', text: 'Needs setup' },
  error: { color: 'error', text: 'Error' },
};
