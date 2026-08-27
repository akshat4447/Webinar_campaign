'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';

export type SelectOption = { value: string; label: string; hint?: string };

/**
 * Filters options by a free-text query, matching either the visible label or
 * the underlying value (so an operator who knows an activity-type id can just
 * type the number). The clear option is always prepended, including while a
 * query is active, so the current choice can be removed without clearing the
 * search first.
 */
export function filterOptions(options: SelectOption[], query: string, emptyLabel: string): SelectOption[] {
  const q = query.trim().toLowerCase();
  const rows = q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : options;
  return [{ value: '', label: emptyLabel }, ...rows];
}

/**
 * Filterable single-select. A native <select> is fine at ten options and
 * unusable at a hundred and seventy — which is what this tenant's activity-type
 * list actually is — so this is a combobox: type to filter, arrows to move,
 * Enter to pick, Escape to close.
 *
 * Deliberately unstyled-by-default beyond the design tokens so it reads as the
 * same control family as .lsq-select next to it.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Search…',
  emptyLabel = '— none —',
  disabled,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => filterOptions(options, query, emptyLabel), [options, query, emptyLabel]);

  // Every close path resets the query and the highlight together, so reopening
  // always starts from a clean filter.
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActive(0);
  }, []);

  // Close on an outside click.
  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open, close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Keep the highlighted row in view while arrowing through 170 options.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function commit(v: string) {
    onChange(v);
    close();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        return Math.max(0, Math.min(filtered.length - 1, next));
      });
    } else if (e.key === 'Enter') {
      if (!open) { setOpen(true); return; }
      e.preventDefault();
      const opt = filtered[active];
      if (opt) commit(opt.value);
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); close(); }
    }
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="lsq-select"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { if (disabled) return; if (open) close(); else setOpen(true); }}
        onKeyDown={onKeyDown}
        style={{
          width: '100%',
          height: 30,
          fontSize: 'var(--fs-label-1)',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: selected ? 'var(--text-primary)' : 'var(--text-placeholder, var(--n50))',
          }}
        >
          {selected ? selected.label : emptyLabel}
        </span>
        <Icon name="chevron-down" size={12} style={{ color: 'var(--n50)', flexShrink: 0 }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 40,
            background: 'var(--surface-card, #fff)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-panel)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: 6, borderBottom: '1px solid var(--border-subtle)' }}>
            <input
              ref={inputRef}
              className="lsq-input"
              type="text"
              value={query}
              placeholder={placeholder}
              onChange={(e) => {
                setQuery(e.target.value);
                // A new filter invalidates the old highlight position.
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              style={{ width: '100%', height: 28, fontSize: 'var(--fs-label-1)' }}
            />
          </div>
          <div ref={listRef} role="listbox" style={{ maxHeight: 240, overflowY: 'auto' }}>
            {filtered.length === 1 && query.trim() ? (
              <div style={{ padding: '10px 12px', fontSize: 'var(--fs-label-2)', color: 'var(--n50)' }}>
                Nothing matches “{query.trim()}”
              </div>
            ) : null}
            {filtered.map((o, i) => (
              <div
                key={`${o.value}-${i}`}
                role="option"
                aria-selected={o.value === value}
                data-active={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(o.value)}
                style={{
                  padding: '7px 12px',
                  fontSize: 'var(--fs-label-1)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  background: i === active ? 'var(--n10)' : 'transparent',
                  color: o.value === '' ? 'var(--n60)' : 'var(--text-primary)',
                  fontWeight: o.value === value ? 600 : 400,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                {o.hint && <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--n50)', flexShrink: 0 }}>{o.hint}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
