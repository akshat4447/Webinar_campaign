'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { generateCopyAnglesAction } from '@/lib/actions/personalize';
import type { MessageAngle } from '@/lib/claude';

export function CopyAnglesModal({
  campaignId,
  stepKey,
  stepLabel,
  channel,
  currentBody,
  canApply = true,
  onApplyAngle,
  onClose,
}: {
  campaignId: string;
  stepKey: string;
  stepLabel: string;
  channel: 'email' | 'linkedin' | 'sms' | 'whatsapp';
  currentBody: string;
  /** False when the currently selected contact has no draft yet to apply an
   *  angle onto — onApplyAngle would be a silent no-op in that case, so the
   *  button is disabled instead of showing a false "Applied" toast. */
  canApply?: boolean;
  onApplyAngle: (angle: MessageAngle) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [angles, setAngles] = useState<MessageAngle[]>([]);
  const [usedFallback, setUsedFallback] = useState(false);
  const [selectedAngleId, setSelectedAngleId] = useState<'pain_point' | 'benchmark_data' | 'story_vision'>('pain_point');
  const { showToast } = useToast();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    generateCopyAnglesAction({
      campaignId,
      stepKey,
      channel,
      stepLabel,
      baseBody: currentBody,
    })
      .then((res) => {
        if (!active) return;
        setAngles(res.angles);
        setUsedFallback(res.usedFallback);
        if (res.angles.length > 0) setSelectedAngleId(res.angles[0].id);
      })
      .catch((err) => {
        if (!active) return;
        showToast(err instanceof Error ? err.message : 'Failed to generate copy angles.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [campaignId, stepKey, channel, stepLabel, currentBody, showToast]);

  async function reRoll() {
    setLoading(true);
    try {
      const res = await generateCopyAnglesAction({
        campaignId,
        stepKey,
        channel,
        stepLabel,
        baseBody: currentBody,
      });
      setAngles(res.angles);
      setUsedFallback(res.usedFallback);
      if (res.angles.length > 0) {
        setSelectedAngleId(res.angles[0].id);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to generate copy angles.');
    } finally {
      setLoading(false);
    }
  }

  const activeAngle = angles.find((a) => a.id === selectedAngleId) ?? angles[0];

  function handleApply() {
    if (!activeAngle || !canApply) return;
    onApplyAngle(activeAngle);
    showToast(`Applied "${activeAngle.name}" angle to message.`);
    onClose();
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(16,20,25,0.45)', zIndex: 1200 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="angles-modal-title"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 720,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 48px)',
          background: '#fff',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-panel)',
          zIndex: 1201,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div>
            <div id="angles-modal-title" style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>⚡ AI Multi-Angle Copy Generator</span>
              <Badge color="blue" text={channel.toUpperCase()} />
            </div>
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginTop: 2 }}>
              Generate and test 3 high-converting psychological angles tailored for {stepLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--n60)', padding: 4 }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!loading && usedFallback && (
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--warning-700)', background: 'var(--warning-100)', borderRadius: 'var(--radius-sm)', padding: '8px 12px' }}>
              Claude wasn&apos;t reachable — these are generic offline templates, not campaign-specific AI copy. Re-roll once Claude is configured for real angles.
            </div>
          )}
          {loading ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--n60)', fontSize: 'var(--fs-label-1)' }}>
              <div style={{ marginBottom: 8 }}>⚡ Claude is composing 3 psychological angles...</div>
              <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>Synthesizing pain-point, benchmark data, and transformational story angles</div>
            </div>
          ) : angles.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--n60)' }}>
              <div>No angles generated.</div>
              <Button size="sm" onClick={reRoll} style={{ marginTop: 12 }}>
                Try again
              </Button>
            </div>
          ) : (
            <>
              {/* Angle Tabs */}
              <div style={{ display: 'flex', gap: 8, background: 'var(--n10)', padding: 4, borderRadius: 'var(--radius-md)' }}>
                {angles.map((a) => {
                  const active = a.id === selectedAngleId;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setSelectedAngleId(a.id)}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 'var(--fs-label-1)',
                        fontWeight: active ? 700 : 500,
                        background: active ? '#fff' : 'transparent',
                        color: active ? 'var(--n90)' : 'var(--n60)',
                        boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {a.name}
                    </button>
                  );
                })}
              </div>

              {/* Active Angle Details */}
              {activeAngle && (
                <div style={{ background: 'var(--surface-page)', borderRadius: 'var(--radius-md)', padding: '16px 18px', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)' }}>
                      {activeAngle.name}
                    </div>
                    <Badge color="blue" text="Psychological Rationale" />
                  </div>
                  <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n70)', fontStyle: 'italic', background: '#fff', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                    💡 {activeAngle.rationale}
                  </div>

                  {activeAngle.subject && (
                    <div>
                      <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                        Subject line
                      </div>
                      <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 600, color: 'var(--n90)', background: '#fff', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                        {activeAngle.subject}
                      </div>
                    </div>
                  )}

                  <div>
                    <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                      Message copy preview
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--fs-label-1)',
                        color: 'var(--n80)',
                        lineHeight: 1.6,
                        background: '#fff',
                        padding: '12px 14px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-subtle)',
                        whiteSpace: 'pre-wrap',
                        fontFamily: channel === 'sms' ? 'monospace' : 'inherit',
                      }}
                    >
                      {activeAngle.body}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', background: 'var(--n10)' }}>
          {!canApply && (
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginBottom: 8, textAlign: 'right' }}>
              This contact has no draft yet — write one first, then apply an angle to it.
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Button size="sm" hierarchy="secondary" onClick={reRoll} disabled={loading}>
              {loading ? 'Re-rolling…' : '🔄 Re-roll with Claude'}
            </Button>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button size="sm" hierarchy="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" hierarchy="primary" onClick={handleApply} disabled={loading || !activeAngle || !canApply}>
                Apply this angle
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
