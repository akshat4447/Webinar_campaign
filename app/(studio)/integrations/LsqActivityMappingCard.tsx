'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { ResultBanner } from './ResultBanner';
import { formatLsqDateTime } from '@/lib/dateFormat';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import {
  listLsqActivityTypesAction,
  getActivityMappingAction,
  saveLsqActivityMappingAction,
} from '@/lib/actions/integrations';

type ChannelKey = 'sms' | 'whatsapp';
const CHANNELS: Array<{ key: ChannelKey; label: string }> = [
  { key: 'sms', label: 'SMS activity' },
  { key: 'whatsapp', label: 'WhatsApp activity' },
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [editingChannels, setEditingChannels] = useState<Record<string, boolean>>({});

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
    setError(null);
    try {
      await saveLsqActivityMappingAction(map, triggerFields);
      setSavedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
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
    <section className="lsq-card" aria-labelledby="lsq-map-title">
      <div className="lsq-card__header">
        <div>
          <h2 className="lsq-card__title" id="lsq-map-title">Activity Mapping for LSQ Automations</h2>
          <p className="lsq-card__sub">
            Pick which activity type is posted when a channel message goes out. Automations then trigger on that activity.
          </p>
        </div>
        <div className="lsq-cluster">
          {!loadingTypes && types.length > 0 && (
            <span className="lsq-hint" title={sourcePath ?? undefined}>
              {types.length.toLocaleString()} types loaded
            </span>
          )}
          <Button hierarchy="secondary" size="sm" icon={<Icon name="refresh" size={16} />} onClick={refresh} loading={loadingTypes}>
            {loadingTypes ? 'Refreshing…' : 'Refresh Metadata'}
          </Button>
        </div>
      </div>

      <div className="lsq-card__body lsq-stack lsq-stack--lg">
        <ResultBanner tone="warning" title="Avoid Duplicate Sends">
          Do not map a channel to an activity type whose automation <em>sends that same channel</em>. The app already sent
          it, so the automation would send a second copy.
        </ResultBanner>

        <div className="lsq-int-map-grid">
          {CHANNELS.map(({ key, label }) => {
            const typeId = map[key]?.typeId;
            const isMapped = !!typeId;
            const isEditing = editingChannels[key];
            const mappedType = types.find((t) => t.id === typeId);
            const typeName = mappedType ? mappedType.name : typeId ? `Activity #${typeId}` : 'Not mapped';

            if (isMapped && !isEditing) {
              return (
                <div key={key} className="lsq-int-map">
                  <div>
                    <div className="lsq-int-map__head">
                      <span className="lsq-int-map__label">{label}</span>
                      <Badge color="success" text="Mapped" dot />
                    </div>
                    <p className="lsq-int-map__value">
                      {typeName} <span className="lsq-hint">(#{typeId})</span>
                    </p>
                  </div>
                  <div className="lsq-int-map__actions">
                    <Button
                      size="sm"
                      hierarchy="secondary"
                      icon={<Icon name="edit" size={16} />}
                      ariaLabel={`Edit ${label} mapping`}
                      onClick={() => setEditingChannels((prev) => ({ ...prev, [key]: true }))}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              );
            }

            return (
              <div key={key} className="lsq-int-map" data-editing={isEditing ? 'true' : 'false'}>
                <div>
                  <div className="lsq-int-map__head">
                    <span className="lsq-int-map__label">{label}</span>
                    {!isEditing && <Badge color="gray" text="Not mapped" />}
                  </div>

                  {isEditing ? (
                    <div role="group" aria-label={`${label} activity type`}>
                      <SearchableSelect
                        value={typeId ? String(typeId) : ''}
                        onChange={(v) => setType(key, v)}
                        placeholder={`Search ${types.length.toLocaleString()} activity types…`}
                        options={optionsFor(key)}
                      />
                    </div>
                  ) : (
                    <p className="lsq-int-map__empty">No LeadSquared activity hook linked yet.</p>
                  )}
                </div>

                <div className="lsq-int-map__actions">
                  {isEditing ? (
                    <>
                      {typeId && (
                        <Button
                          size="sm"
                          hierarchy="tertiary"
                          onClick={() => {
                            setType(key, '');
                            setEditingChannels((prev) => ({ ...prev, [key]: false }));
                          }}
                        >
                          Clear
                        </Button>
                      )}
                      <Button size="sm" hierarchy="secondary" onClick={() => setEditingChannels((prev) => ({ ...prev, [key]: false }))}>
                        Done
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      hierarchy="secondary"
                      icon={<Icon name="plus" size={16} />}
                      ariaLabel={`Map an activity to ${label}`}
                      onClick={() => setEditingChannels((prev) => ({ ...prev, [key]: true }))}
                    >
                      Map Activity
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="lsq-stack lsq-stack--sm">
          <div>
            <button type="button" className="lsq-int-disclosure" onClick={() => setAdvancedOpen((o) => !o)} aria-expanded={advancedOpen} aria-controls="lsq-map-advanced">
              <Icon name="chevron-down" size={16} />
              Advanced: trigger activity field schema names
            </button>
          </div>
          {advancedOpen && (
            <div id="lsq-map-advanced" className="lsq-int-fields">
              {(['channel', 'stepKey', 'message'] as const).map((k) => (
                <Field key={k} label={k}>
                  {(p) => (
                    <input
                      {...p}
                      className="lsq-input"
                      type="text"
                      value={(triggerFields as Record<string, string>)[k]}
                      onChange={(e) => setTriggerFields((f) => ({ ...f, [k]: e.target.value }))}
                    />
                  )}
                </Field>
              ))}
            </div>
          )}
        </div>

        <div className="lsq-cluster">
          <Button hierarchy="primary" size="sm" onClick={save} loading={saving}>
            {saving ? 'Saving…' : savedAt ? 'Saved' : 'Save Mapping'}
          </Button>
          {savedAt && <span className="lsq-hint">Saved at {formatLsqDateTime(new Date(savedAt))}</span>}
          {!savedAt && !everSaved && !error && (
            <span className="lsq-hint">No mapping saved yet. Nothing is posted per channel until one is saved.</span>
          )}
        </div>
        {error && <ResultBanner tone="error">{error}</ResultBanner>}
      </div>
    </section>
  );
}
