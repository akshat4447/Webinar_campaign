import { Badge } from '@/components/ui/Badge';

/**
 * Used to vary by which tab was open, from when the workspace was a linear
 * wizard (setup → scoring → templates → personalize → schedule → control →
 * dashboard) and each tab was a stage you finished in order. The C2B restructure
 * made every tab always-accessible, so "which tab am I on" stopped meaning
 * "how far along is this campaign" — the two names didn't even line up any more
 * (`overview`, `audience`, `messaging`… none of them matched the old keys, so
 * this silently showed "Draft — not yet launched" on every tab of every
 * campaign, launched or not). The campaign's real status is the only thing
 * that should answer "how far along is this", so that's what this reads now.
 */
function badgeFor(status: string, cadenceStatus: string): { text: string; color: string } {
  if (status === 'completed') return { text: 'Post-event complete', color: 'success' };
  if (status === 'live') {
    if (cadenceStatus === 'running') return { text: 'Cadence live', color: 'success' };
    if (cadenceStatus === 'paused') return { text: 'Cadence paused', color: 'warning' };
    if (cadenceStatus === 'stopped') return { text: 'Cadence stopped', color: 'gray' };
    return { text: 'Ready to launch', color: 'blue' };
  }
  return { text: 'Draft — not yet launched', color: 'gray' };
}

export function StageBadge({ status, cadenceStatus }: { status: string; cadenceStatus: string }) {
  const badge = badgeFor(status, cadenceStatus);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)' }}>Campaign status</span>
      <Badge color={badge.color} text={badge.text} dot />
    </div>
  );
}
