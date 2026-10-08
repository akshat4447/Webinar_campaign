# UI kit — how to build a screen in Webinar Studio

Source of truth: the LeadSquared Design System (tokens in `styles/tokens`, primitives in `styles/components.css`, screen styles in `styles/screens/*.css`). **Do not invent new visual rules.**

## Hard rules
1. **Tokens only.** No raw hex, rgb(), px font sizes, or hand-picked radii in TSX. Use `var(--accent-500)`, `var(--text-secondary)`, `var(--space-12)`, `var(--radius-lg)`, `var(--fs-label-1)`, `var(--fw-bold)`, `var(--shadow-card)`. Spacing is the token scale (2,4,6,8,12,16,20,24,32,40,56) — never snap to a grid of 4/8.
2. **No emoji, no unicode glyph icons (✓ ✦ ⚡ ← → × ✎ 🔒…).** Use `<Icon name="…" />` (list below). Arrows in labels are removed ("Continue", not "Continue →").
3. **No gradients, no blur, no illustrations, no decorative shadows.** Cards are white (`.lsq-card`) on the pale canvas, 12px radius, **no border**. Max two background colours per surface.
4. **Status = `<Badge>`** (colors: success, warning, error, gray, blue, `blue light`, purple, orange, indigo; aliases green/danger/amber). Never a hand-coloured span.
5. **Copy:** headings and buttons in **Title Case**; labels, hints, table cells and body in sentence case. Do not address the reader as "you/your" in UI copy. No exclamation marks. Dates: `12 Jan 2020 | 01:22 PM` via `lib/dateFormat.ts` (`formatLsqDate`, `formatLsqDateTime`). Numbers: `toLocaleString()`.
6. **Inline `style={{}}` only for a truly dynamic value** (a computed width %, a data-driven colour token). Everything else is a class. Move repeated patterns into `styles/screens/<area>.css` with `.lsq-<area>-<thing>` names.
7. **Accessibility:** every control has a visible label or `aria-label`; icon-only buttons use `<Button iconPosition="only" ariaLabel=…>`; dialogs use `components/ui/Modal`/`ConfirmDialog`/`Drawer` (they set role, aria-modal, focus trap, Escape); errors use `role="alert"` and are tied with `aria-describedby` (use `<Field>`); focus must stay visible; touch targets ≥ 32px; text ≥ 12px (`--fs-label-2`); tables have `<th scope>`; lists are `<ul>`.
8. **Responsive:** works at 1440 and 390 px with no horizontal page scroll. Use `.lsq-grid`, `.lsq-stack`, `.lsq-cluster`, `.lsq-toolbar`, `.lsq-with-aside` instead of fixed widths.
9. **Do not change behaviour.** Server actions, state, validation, routing and data flow stay as they are. Preserve every existing control unless the task says otherwise. Keep `useEscapeKey` / `useModalFocus` behaviour.

## Page skeleton
```tsx
<main style={{ flex: 1, overflowY: 'auto' }}>   {/* the scroll container */}
  <div className="lsq-page">                     {/* 16px padding, 16px gap; add lsq-page--form (max 960) for forms */}
    <header className="lsq-page-header">
      <div className="lsq-page-header__text">
        <p className="lsq-page-header__eyebrow">Eyebrow</p>
        <h1 className="lsq-page-header__title">Page Title</h1>
        <p className="lsq-page-header__sub">One sentence of context.</p>
      </div>
      <div className="lsq-page-header__actions">{/* primary action last */}</div>
    </header>
    <section className="lsq-card" aria-labelledby="x">
      <div className="lsq-card__header"><div><h2 className="lsq-card__title" id="x">Card Title</h2><p className="lsq-card__sub">Optional.</p></div></div>
      <div className="lsq-card__body lsq-stack">…</div>
      <div className="lsq-card__footer">{/* buttons, right aligned */}</div>
    </section>
  </div>
</main>
```

## Classes (all in styles/components.css)
- Layout: `lsq-page`, `lsq-page--narrow|--form`, `lsq-stack` (`--sm|--lg`), `lsq-cluster` (`--between`), `lsq-grow`, `lsq-grid` (`--wide|--narrow`), `lsq-with-aside` (content + 340px side column), `lsq-toolbar`, `lsq-toolbar__group`, `lsq-divider`.
- Cards/stats: `lsq-card` (+`__header|__title|__sub|__body|__footer`), `lsq-card--interactive`, `lsq-stat` (+`__label|__value|__note`), `lsq-kv` (dl key/value grid).
- Feedback: `lsq-banner` + `--success|--warning|--error|--neutral` (+`__title|__body|__actions`), `lsq-empty` (+`__title|__body|__icon`), `lsq-progress` (+`__bar`, `--success|--danger`), `lsq-spinner`, `lsq-skeleton`, Toast via `useToast()`.
- Forms: `lsq-field`, `lsq-label`, `lsq-hint`, `lsq-error`, `input.lsq-input`, `textarea.lsq-input`, `select.lsq-select`, `lsq-check` (checkbox/radio row), `lsq-segmented` (buttons with `aria-pressed`), `lsq-search`, `lsq-select`.
- Navigation: `lsq-tabs` + `lsq-tab` (`aria-selected`), `lsq-stepper` + `lsq-step` + `lsq-step__n`, `lsq-menu` (`<details>` dropdown with `lsq-menu__panel|__item`).
- Data: `lsq-table-wrap` + `lsq-table` (`lsq-cell-primary|secondary|truncate`), `lsq-rows` + `lsq-orow` (person/record rows), `lsq-checklist` (`data-state=done|warn|blocked`), `lsq-avatar`, `lsq-tag`, `lsq-code`, `lsq-msgbox`, `lsq-chip(s)`, `lsq-linkbtn`.
- Cadence: `lsq-stage__*`, `lsq-steps`, `lsq-step-row`, `lsq-timing`, `lsq-chan`, `lsq-branch(es)`.
- Overlays: `lsq-overlay`, `lsq-modal` (+`--sm|--lg`, `__header|__title|__sub|__body|__footer`), `lsq-drawer`, `lsq-icon-btn`.

## Components
`Button` (hierarchy primary|secondary|secondary-color|tertiary|tertiary-color|destructive|destructive-outline|link; size sm|md|lg; `icon`, `iconPosition` leading|trailing|only, `loading`, `ariaLabel`, `type`), `Badge`, `Icon`, `Modal` (title, subtitle, footer, size sm|md|lg, busy), `ConfirmDialog`, `Drawer`, `Field` (label/hint/error/required wiring), `Toggle`, `Checkbox`, `Card`, `Avatar`, `Skeleton*`, `PageHeader`, `SearchableSelect`.

## Icons (`<Icon name size />`, currentColor outline)
arrow-down arrow-left arrow-right arrow-up bar-chart bell bolt calendar chat check check-circle chevron-down chevron-left chevron-right chevron-up clock close copy dashboard database document download edit error external eye eye-off file-text filter globe grid help home image info key link linkedin list lock mail minus more pause phone play plug plus refresh rows search send settings share shield skip sliders sms sort sparkle stop tag template trash trending undo upload user users video warning whatsapp x x-circle zap.
Do **not** edit `components/ui/Icon.tsx` (shared). If a glyph is missing, use the closest one and list the missing name in your report.

## Verification you must do for every screen you touch
1. `npx tsc --noEmit 2>&1 | grep -v "^.next"` clean for your files, `npx eslint <your files>` clean, `npx vitest run` green (update a test only when it asserts removed markup/copy; say so).
2. Screenshot at 1440×900 and 390×844 with the browser skill against the shared dev server (`http://localhost:3100`, loops disabled) and look at them. No horizontal page scroll (`document.documentElement.scrollWidth <= clientWidth`), no console errors.
3. Drive the interactions you touched (open/close modals with Escape, tab through a form, submit with an error).
4. Never click anything that sends a message, registers a person, or calls LeadSquared/Zoom/Apollo/Claude for real. The connected tenants may be production. Read-only navigation and local-state interactions only.
