'use client';

import { useEffect, useState } from 'react';

export function AttendeeCountdown({ scheduledAt }: { scheduledAt: string }) {
  const target = new Date(scheduledAt).getTime();
  // undefined = not yet computed on the client (matches server render, so no
  // hydration mismatch); 'live' = started within the last 3 hours (same
  // window /r/[token] uses to decide whether to jump straight to the join
  // link); 'ended' = further past than that. Collapsing all three into one
  // falsy state made a webinar that ended days ago still show "Live now"
  // forever.
  const [timeLeft, setTimeLeft] = useState<{ days: number; hours: number; minutes: number; seconds: number } | 'live' | 'ended' | undefined>(undefined);

  useEffect(() => {
    function calc() {
      const diff = target - Date.now();
      if (diff <= 0) {
        setTimeLeft(diff >= -3 * 60 * 60 * 1000 ? 'live' : 'ended');
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / (1000 * 60)) % 60);
      const seconds = Math.floor((diff / 1000) % 60);
      setTimeLeft({ days, hours, minutes, seconds });
    }

    calc();
    const interval = setInterval(calc, 1000);
    return () => clearInterval(interval);
  }, [target]);

  if (timeLeft === undefined) return null;

  if (timeLeft === 'ended') {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--n10)', color: 'var(--n60)', padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600 }}>
        This session has ended
      </div>
    );
  }

  if (timeLeft === 'live') {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#FEF3C7', color: '#92400E', padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#D97706', display: 'inline-block' }} />
        Starting soon / Live now
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, margin: '14px 0 20px' }}>
      {timeLeft.days > 0 && (
        <div style={{ background: 'var(--n10)', padding: '8px 12px', borderRadius: 'var(--radius-md)', minWidth: 54, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--n90)' }}>{timeLeft.days}</div>
          <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--n50)', fontWeight: 600 }}>Days</div>
        </div>
      )}
      <div style={{ background: 'var(--n10)', padding: '8px 12px', borderRadius: 'var(--radius-md)', minWidth: 54, textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--n90)' }}>{String(timeLeft.hours).padStart(2, '0')}</div>
        <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--n50)', fontWeight: 600 }}>Hours</div>
      </div>
      <div style={{ background: 'var(--n10)', padding: '8px 12px', borderRadius: 'var(--radius-md)', minWidth: 54, textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--n90)' }}>{String(timeLeft.minutes).padStart(2, '0')}</div>
        <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--n50)', fontWeight: 600 }}>Mins</div>
      </div>
      <div style={{ background: 'var(--n10)', padding: '8px 12px', borderRadius: 'var(--radius-md)', minWidth: 54, textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--n90)' }}>{String(timeLeft.seconds).padStart(2, '0')}</div>
        <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--n50)', fontWeight: 600 }}>Secs</div>
      </div>
    </div>
  );
}
