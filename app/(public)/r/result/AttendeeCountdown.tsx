'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';

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
      <div className="lsq-home-count-state">
        <Badge color="gray" text="This session has ended" />
      </div>
    );
  }

  if (timeLeft === 'live') {
    return (
      <div className="lsq-home-count-state">
        <Badge color="warning" text="Starting soon or live now" dot />
      </div>
    );
  }

  const units = [
    ...(timeLeft.days > 0 ? [{ n: String(timeLeft.days), label: 'Days' }] : []),
    { n: String(timeLeft.hours).padStart(2, '0'), label: 'Hours' },
    { n: String(timeLeft.minutes).padStart(2, '0'), label: 'Mins' },
    { n: String(timeLeft.seconds).padStart(2, '0'), label: 'Secs' },
  ];

  return (
    <div className="lsq-home-count" role="timer" aria-label="Time until the webinar starts">
      {units.map((u) => (
        <div key={u.label} className="lsq-home-count__unit">
          <div className="lsq-home-count__n">{u.n}</div>
          <div className="lsq-home-count__label">{u.label}</div>
        </div>
      ))}
    </div>
  );
}
