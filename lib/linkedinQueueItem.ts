import type { VerificationStatus } from '@/lib/apolloVerify';

export interface LinkedInQueueItem {
  id: string;
  name: string;
  title: string;
  account: string;
  url: string;
  message: string;
  personalized?: boolean;
  /** True when the personalized draft failed validation (missing link, leftover
   *  {{token}}) — the queue falls back to the message shown, but a human still
   *  needs to know their "personalized" draft for this recipient was actually
   *  rejected rather than intentionally generic. */
  personalizedInvalid?: boolean;
  slug?: string | null;
  /** Apollo people-match verdict taken before this person may be contacted. */
  checkStatus?: VerificationStatus | null;
  checkNote?: string | null;
}
