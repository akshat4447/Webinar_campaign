import Link from 'next/link';
import { CONTACT_PAGE_SIZE } from '@/lib/contactPagination';

/** One compact row: search on the left, where you are in the list and the page links on the right. */
export function ContactPagination({ path, page, total, q, params = {}, label = 'contacts' }: {
  path: string; page: number; total: number; q: string; params?: Record<string,string>; label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / CONTACT_PAGE_SIZE));
  const href = (target: number) => `${path}?${new URLSearchParams({ ...params, ...(q ? { q } : {}), page: String(target) })}`;
  const inputId = `pager-search-${label.replace(/\W+/g, '-')}`;
  const range = total
    ? `${((page - 1) * CONTACT_PAGE_SIZE + 1).toLocaleString()}–${Math.min(page * CONTACT_PAGE_SIZE, total).toLocaleString()} of ${total.toLocaleString()}`
    : 'No matching contacts';
  return <section className="lsq-card lsq-pager" aria-label={`${label} search and pagination`}>
    <form action={path} role="search" className="lsq-pager__search">
      {Object.entries(params).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <label className="lsq-sr-only" htmlFor={inputId}>Search {label}</label>
      <input id={inputId} name="q" type="search" className="lsq-input lsq-pager__input" defaultValue={q} maxLength={160} placeholder="Search name, email, company or title" />
      <button type="submit" className="lsq-btn lsq-btn--sm lsq-btn--secondary">Search</button>
      {q && <Link className="lsq-btn lsq-btn--sm lsq-btn--tertiary" href={`${path}?${new URLSearchParams(params)}`}>Clear search</Link>}
    </form>
    <nav aria-label={`${label} pages`} className="lsq-pager__pages">
      <span className="lsq-hint">{range} · Page {page.toLocaleString()} of {pages.toLocaleString()}</span>
      {page > 1 && <Link className="lsq-btn lsq-btn--sm lsq-btn--secondary" href={href(page - 1)}>Previous page</Link>}
      {page < pages && <Link className="lsq-btn lsq-btn--sm lsq-btn--secondary" href={href(page + 1)}>Next page</Link>}
    </nav>
  </section>;
}
