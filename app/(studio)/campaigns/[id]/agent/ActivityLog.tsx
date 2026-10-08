import { Badge } from '@/components/ui/Badge';
import { formatLsqDateTime } from '@/lib/dateFormat';

// Each log entry carries the colour token of whichever action wrote it. That token is data, so it is
// mapped onto a status label, a Badge colour and a tone for the numbered marker.
const STATUS_BY_DOT: Record<string, { label: string; badge: string; tone: 'success' | 'warning' | 'info' }> = {
  'var(--success-500)': { label: 'Done', badge: 'success', tone: 'success' },
  'var(--warning-700)': { label: 'Attention', badge: 'warning', tone: 'warning' },
  'var(--accent-500)': { label: 'Running', badge: 'blue', tone: 'info' },
};

interface LogRow {
  id: string;
  text: string;
  dot: string;
  createdAt: Date;
}

/**
 * The numbered activity log the prototype shows on Agent run.
 *
 * Every entry already carries a semantic colour (`dot`) from whichever action
 * wrote it — success green, warning amber, or the default accent for a
 * plain informational entry. Rather than adding a schema column for a status
 * label, this maps the colour that already exists onto one, so a log entry
 * written before this checkpoint renders exactly the same as one written
 * after it.
 */
export function ActivityLog({ entries }: { entries: LogRow[] }) {
  return (
    <section className="lsq-card" aria-labelledby="res-activity">
      <div className="lsq-card__header">
        <h2 className="lsq-card__title" id="res-activity">Agent Activity</h2>
        <Badge color="success" text="Live, real-time to LeadSquared" dot />
      </div>

      {entries.length === 0 ? (
        <div className="lsq-card__body">
          <p className="lsq-hint">No activity yet.</p>
        </div>
      ) : (
        <ol className="lsq-res-log">
          {entries.map((e, i) => {
            const status = STATUS_BY_DOT[e.dot] ?? STATUS_BY_DOT['var(--accent-500)'];
            // Oldest first, numbered from 1 — the log reads top-to-bottom as
            // the order things actually happened, and the ordinal is a real
            // sequence number, not a decoration.
            return (
              <li key={e.id} className="lsq-res-log__item">
                <span className="lsq-res-log__n" data-tone={status.tone} aria-hidden="true">{i + 1}</span>
                <div className="lsq-res-log__main">
                  <p className="lsq-res-log__text">{e.text}</p>
                  <p className="lsq-res-log__time">{formatLsqDateTime(e.createdAt)}</p>
                </div>
                <Badge color={status.badge} text={status.label} />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
