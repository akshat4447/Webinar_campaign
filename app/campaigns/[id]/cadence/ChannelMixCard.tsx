'use client';

// "Send through everything" — one card that turns a whole channel on or off.
// Email/LinkedIn/SMS/WhatsApp toggles bulk-enable their steps; disabling parks
// queued-but-unsent sends so nothing slips out after you said stop.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { setChannelEnabledAction } from '@/lib/actions/channels';
import type { MixChannel } from '@/lib/actions/channels';

const CHANNELS: Array<{ key: MixChannel; label: string; hint: string; need: string }> = [
  { key: 'email', label: 'Email', hint: 'invite · nudge · final · reminders · follow-ups', need: 'a verified email' },
  { key: 'linkedin', label: 'LinkedIn', hint: 'manual touch step (assisted by design)', need: 'nothing — manual' },
  { key: 'sms', label: 'SMS', hint: 'invite at launch · T-1h reminder', need: 'a mobile number' },
  { key: 'whatsapp', label: 'WhatsApp', hint: 'invite at launch · registration confirmation', need: 'a mobile + opt-in' },
];

export function ChannelMixCard({
  campaignId,
  initial,
  reach,
  approved,
}: {
  campaignId: string;
  initial: Record<MixChannel, { enabled: number; total: number }>;
  /** How many approved contacts each channel can actually reach. */
  reach: Record<MixChannel, number>;
  approved: number;
}) {
  const router = useRouter();
  const [mix, setMix] = useState(initial);
  const [busy, setBusy] = useState<MixChannel | null>(null);

  async function toggle(ch: MixChannel) {
    const nextEnabled = mix[ch].enabled < mix[ch].total;
    setBusy(ch);
    await setChannelEnabledAction(campaignId, ch, nextEnabled);
    setMix((m) => ({ ...m, [ch]: { ...m[ch], enabled: nextEnabled ? m[ch].total : 0 } }));
    setBusy(null);
    router.refresh();
  }

  return (
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 18px' }}>
      <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 4 }}>Channel mix</div>
      <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', lineHeight: 1.5, marginBottom: 12 }}>
        Choose which channels this cadence uses. Disabling one parks its queued sends immediately.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {CHANNELS.map(({ key, label, hint, need }) => {
          const on = mix[key].enabled > 0;
          return (
            <div
              key={key}
              onClick={() => !busy && toggle(key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 'var(--radius-md)',
                boxShadow: on ? 'inset 0 0 0 1.5px var(--accent-500)' : 'inset 0 0 0 1px var(--border-subtle)',
                cursor: busy === key ? 'wait' : 'pointer',
                background: on ? 'var(--accent-50)' : '#fff',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 30,
                  height: 17,
                  borderRadius: 'var(--radius-full)',
                  background: on ? 'var(--accent-500)' : 'var(--n20)',
                  position: 'relative',
                  flexShrink: 0,
                  transition: 'background .15s ease',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 2,
                    left: on ? 15 : 2,
                    width: 13,
                    height: 13,
                    borderRadius: '50%',
                    background: '#fff',
                    boxShadow: '0 1px 2px rgba(0,0,0,.25)',
                    transition: 'left .15s ease',
                  }}
                />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 600, color: 'var(--n90)' }}>{label}</div>
                <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>{hint}</div>
                {/* Turning a channel on is meaningless if nobody is contactable
                    on it, so say who it can actually reach and what's missing. */}
                <div
                  style={{
                    fontSize: 'var(--fs-label-2)',
                    color: reach[key] === 0 ? 'var(--warning-700)' : 'var(--text-secondary)',
                    marginTop: 2,
                  }}
                  className="lsq-num"
                >
                  {reach[key] === 0
                    ? `reaches nobody yet — needs ${need}`
                    : `reaches ${reach[key]} of ${approved} approved`}
                </div>
              </div>
              <Badge color={on ? 'success' : 'gray'} text={on ? `${mix[key].enabled}/${mix[key].total} on` : 'off'} dot />
            </div>
          );
        })}
      </div>
    </div>
  );
}