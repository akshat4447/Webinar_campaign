'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { listLsqActivityTypesAction, getActivityMappingAction, saveLsqActivityMappingAction } from '@/lib/actions/integrations';

type ChannelKey = 'email' | 'linkedin' | 'sms' | 'whatsapp';
const CHANNELS: Array<{ key: ChannelKey; label: string }> = [
  { key: 'email', label: 'Email sent' },
  { key: 'linkedin', label: 'LinkedIn touch done' },
  { key: 'sms', label: 'SMS delivered' },
  { key: 'whatsapp', label: 'WhatsApp delivered' },
];

/**
 * Maps each channel to a LeadSquared ACTIVITY TYPE so the operator's own
 * automations can react on any stage (e.g. "when WebinarAgent WhatsApp
 * delivered → run my nurture program"). Also exposes the trigger activity's
 * custom-field schema names for manual override.
 */
export function LsqActivityMappingCard() {
  const [types, setTypes] = useState<Array<{ id: number; name: string }>>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [map, setMap] = useState<Record<string, { typeId?: number } | null>>({});
  const [triggerFields, setTriggerFields] = useState({ channel: 'mx_Custom_1', stepKey: 'mx_Custom_2', message: 'mx_Custom_3' });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getActivityMappingAction().then((r) => {
      setMap(r.map);
      setTriggerFields(r.triggerFields);
    });
  }, []);

  async function loadTypes() {
    setLoadingTypes(true);
    setError(null);
    const res = await listLsqActivityTypesAction();
    setLoadingTypes(false);
    if (res.ok) setTypes(res.types);
    else setError(res.error);
  }

  async function save() {
    setSaving(true);
    await saveLsqActivityMappingAction(map, triggerFields);
    setSaving(false);
    setSavedAt(new Date().toISOString());
  }

  function setType(ch: ChannelKey, value: string) {
    const id = Number(value);
    setMap((m) => ({ ...m, [ch]: Number.isFinite(id) && id > 0 ? { typeId: id } : null }));
  }

  return (
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '14px 20px', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--n90)' }}>Activity mapping — hooks for your LSQ Automations</div>
          <div style={{ fontSize: 11.5, color: 'var(--n60)', lineHeight: 1.5 }}>
            Pick which activity type we post when a channel message goes out. Your automations then trigger on that activity.
          </div>
        </div>
        <Button hierarchy="tertiary" size="sm" onClick={loadTypes} disabled={loadingTypes}>
          {loadingTypes ? 'Loading…' : types.length ? 'Reload types' : 'Load activity types from LSQ'}
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10, marginBottom: 10 }}>
        {CHANNELS.map(({ key, label }) => (
          <div key={key} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--n80)', marginBottom: 6 }}>{label}</div>
            <select className="lsq-select" style={{ width: '100%', height: 30, fontSize: 12 }} value={map[key]?.typeId ?? ''} onChange={(e) => setType(key, e.target.value)}>
              <option value="">— none —</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (#{t.id})
                </option>
              ))}
              {[...Array(0)].length === 0 && map[key]?.typeId && !types.some((t) => t.id === map[key]!.typeId) && (
                <option value={map[key]!.typeId}>#{map[key]!.typeId}</option>
              )}
            </select>
          </div>
        ))}
      </div>

      <details style={{ fontSize: 11.5, color: 'var(--n60)', marginBottom: 10 }}>
        <summary style={{ cursor: 'pointer' }}>Advanced: trigger activity field schema names</summary>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {(['channel', 'stepKey', 'message'] as const).map((k) => (
            <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 140 }}>
              <span>{k}</span>
              <input className="lsq-input" type="text" value={(triggerFields as Record<string, string>)[k]} onChange={(e) => setTriggerFields((f) => ({ ...f, [k]: e.target.value }))} />
            </label>
          ))}
        </div>
      </details>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Button hierarchy="primary" size="sm" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : savedAt ? 'Saved ✓' : 'Save mapping'}
        </Button>
        {savedAt && <span style={{ fontSize: 11, color: 'var(--n50)' }}>Saved {new Date(savedAt).toLocaleTimeString('en-GB', { hour12: false })}</span>}
        {error && <span style={{ fontSize: 11.5, color: 'var(--danger-500)' }}>{error}</span>}
      </div>
    </div>
  );
}