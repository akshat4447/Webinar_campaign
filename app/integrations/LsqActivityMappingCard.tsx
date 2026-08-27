'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
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
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [everSaved, setEverSaved] = useState(false);

  // Both halves load on open. The types used to require clicking a quiet
  // tertiary button, so the card rendered four empty dropdowns and looked
  // broken before you found the control.
  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoadingTypes(true);
    setError(null);
    const [mapping, res] = await Promise.all([getActivityMappingAction(), listLsqActivityTypesAction()]);
    setMap(mapping.map);
    setTriggerFields(mapping.triggerFields);
    setEverSaved(mapping.everSaved);
    if (res.ok) {
      setTypes(res.types);
      setSourcePath(res.sourcePath ?? null);
    } else {
      setTypes([]);
      setSourcePath(null);
      setError(res.error);
    }
    setLoadingTypes(false);
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

  // The saved id may no longer exist in the tenant (renamed/deleted type). It
  // still has to appear as a choice, or saving would silently drop the mapping.
  function optionsFor(key: ChannelKey) {
    const opts = types.map((t) => ({ value: String(t.id), label: t.name, hint: `#${t.id}` }));
    const saved = map[key]?.typeId;
    if (saved && !types.some((t) => t.id === saved)) {
      opts.unshift({ value: String(saved), label: `#${saved} (not in this account)`, hint: '' });
    }
    return opts;
  }

  return (
    <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '14px 20px', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)' }}>Activity mapping — hooks for your LSQ Automations</div>
          <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', lineHeight: 1.5 }}>
            Pick which activity type we post when a channel message goes out. Your automations then trigger on that activity.
          </div>
          <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--warning-700)', lineHeight: 1.5, marginTop: 4 }}>
            Don&apos;t map a channel to an activity type whose automation <em>sends that same channel</em> — the app already sent it,
            so the automation sends a second copy. Email is sent directly by the app; leave it unmapped unless your automation only
            logs or scores.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {!loadingTypes && types.length > 0 && (
            <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }} title={sourcePath ?? undefined}>
              {types.length} types loaded
            </span>
          )}
          <Button hierarchy="secondary" size="sm" onClick={refresh} disabled={loadingTypes}>
            {loadingTypes ? 'Refreshing…' : 'Refresh metadata'}
          </Button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10, marginBottom: 10 }}>
        {CHANNELS.map(({ key, label }) => (
          <div key={key} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 10 }}>
            <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 600, color: 'var(--n80)', marginBottom: 6 }}>{label}</div>
            <SearchableSelect
              value={map[key]?.typeId ? String(map[key]!.typeId) : ''}
              onChange={(v) => setType(key, v)}
              placeholder={`Search ${types.length} activity types…`}
              options={optionsFor(key)}
            />
          </div>
        ))}
      </div>

      <details style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginBottom: 10 }}>
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
        {savedAt && <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>Saved {new Date(savedAt).toLocaleTimeString('en-GB', { hour12: false })}</span>}
        {!savedAt && !everSaved && !error && (
          <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>No mapping saved yet — nothing is posted per channel until you save one.</span>
        )}
        {error && <span style={{ fontSize: 'var(--fs-label-2)', color: 'var(--danger-500)', overflowWrap: 'anywhere' }}>{error}</span>}
      </div>
    </div>
  );
}