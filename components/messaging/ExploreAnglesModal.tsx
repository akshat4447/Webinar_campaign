'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { generateCopyAnglesAction } from '@/lib/actions/personalize';
import type { MessageAngle } from '@/lib/claude';
import type { SpeakerInput } from '@/lib/speakerUtils';

interface ExploreAnglesModalProps {
  open: boolean;
  onClose: () => void;
  campaignId?: string;
  topic: string;
  speakers?: SpeakerInput[];
  speakerName?: string | null;
  speakerTitle?: string | null;
  brief?: string | null;
  stepKey?: string;
  stepLabel: string;
  channel: 'email' | 'linkedin' | 'sms' | 'whatsapp';
  baseBody?: string;
  onApplyAngle: (angle: MessageAngle) => void;
}

const ANGLE_ICONS: Record<string, 'warning' | 'bar-chart' | 'trending'> = {
  pain_point: 'warning',
  benchmark_data: 'bar-chart',
  story_vision: 'trending',
};

const ANGLE_SUBTITLES: Record<string, string> = {
  pain_point: 'Cost of inaction, friction and risk',
  benchmark_data: 'Market authority, hard metrics and trends',
  story_vision: 'Peer blueprint, narrative transformation',
};

const CHANNEL_LABEL: Record<string, string> = { email: 'Email', linkedin: 'LinkedIn', sms: 'SMS', whatsapp: 'WhatsApp' };

export function ExploreAnglesModal({
  open,
  onClose,
  campaignId,
  topic,
  speakers,
  speakerName,
  speakerTitle,
  brief,
  stepKey,
  stepLabel,
  channel,
  baseBody,
  onApplyAngle,
}: ExploreAnglesModalProps) {
  const [loading, setLoading] = useState(false);
  const [angles, setAngles] = useState<MessageAngle[]>([]);
  const [usedFallback, setUsedFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function fetchAngles() {
      setLoading(true);
      setError(null);
      try {
        const res = await generateCopyAnglesAction({
          campaignId,
          topic,
          speakers: speakers?.map((s) => ({ name: s.name, title: s.title, company: s.company })),
          speakerName,
          speakerTitle,
          brief,
          stepKey,
          channel,
          stepLabel,
          baseBody,
        });

        if (!cancelled) {
          setAngles(res.angles || []);
          setUsedFallback(res.usedFallback);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to generate copy angles.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchAngles();

    return () => {
      cancelled = true;
    };
  }, [open, campaignId, topic, speakers, speakerName, speakerTitle, brief, stepKey, stepLabel, channel, baseBody]);

  const channelLabel = CHANNEL_LABEL[channel] ?? channel;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      size="lg"
      title="Explore Copy Angles"
      subtitle={`Three framings for ${channelLabel}, based on the topic and speaker context.`}
      footer={
        <Button hierarchy="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="lsq-stack">
        <div className="lsq-cluster lsq-cluster--between">
          <div>
            <p className="lsq-hint">
              {stepLabel} · {channelLabel}
            </p>
            <p className="lsq-msg-section-title">{topic || 'Webinar outreach'}</p>
          </div>
          <Badge color={usedFallback ? 'warning' : 'blue'} text={usedFallback ? 'Fallback Templates' : 'Claude'} dot />
        </div>

        {loading ? (
          <div className="lsq-msg-loading" role="status">
            <span className="lsq-spinner" aria-hidden="true" />
            <strong>Analyzing topic, speaker context and channel</strong>
            <span>Writing three distinct angles for {channelLabel}</span>
          </div>
        ) : error ? (
          <div className="lsq-banner lsq-banner--error" role="alert">
            <p className="lsq-banner__body">{error}</p>
          </div>
        ) : (
          <ul className="lsq-rows">
            {angles.map((angle) => {
              const subtitle = ANGLE_SUBTITLES[angle.id] || angle.rationale;
              return (
                <li key={angle.id} className="lsq-msg-angle">
                  <div className="lsq-msg-angle__head">
                    <div>
                      <h3 className="lsq-msg-angle__name">
                        <Icon name={ANGLE_ICONS[angle.id] ?? 'sparkle'} size={16} />
                        {angle.name}
                      </h3>
                      <p className="lsq-msg-angle__sub">{subtitle}</p>
                    </div>
                    <Button
                      hierarchy="primary"
                      size="sm"
                      onClick={() => {
                        onApplyAngle(angle);
                        onClose();
                      }}
                    >
                      Use This Angle
                    </Button>
                  </div>
                  <p className="lsq-hint">Why it works: {angle.rationale}</p>
                  {channel === 'email' && angle.subject && <p className="lsq-msg-section-title">Subject: {angle.subject}</p>}
                  <div className="lsq-msg-angle__body">{angle.body}</div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
