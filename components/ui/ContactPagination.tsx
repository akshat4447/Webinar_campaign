import Link from 'next/link';
import { CONTACT_PAGE_SIZE } from '@/lib/contactPagination';

export function ContactPagination({ path, page, total, q, params = {}, label = 'contacts' }: {
  path: string; page: number; total: number; q: string; params?: Record<string,string>; label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / CONTACT_PAGE_SIZE));
  const href = (target: number) => `${path}?${new URLSearchParams({ ...params, ...(q ? { q } : {}), page: String(target) })}`;
  return <section className="lsq-card" style={{ padding: 'var(--space-16)', marginBottom: 'var(--space-16)' }} aria-label={`${label} search and pagination`}>
    <form action={path} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 'var(--space-8)' }}>
      {Object.entries(params).map(([name,value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <label>Search {label}<input name="q" type="search" defaultValue={q} maxLength={160} placeholder="Name, email, company or title" style={{ display: 'block', padding: 'var(--space-8)', marginTop: 'var(--space-4)' }} /></label>
      <button type="submit" className="lsq-btn lsq-btn--secondary">Search</button>
      {q && <Link href={`${path}?${new URLSearchParams(params)}`}>Clear search</Link>}
    </form>
    <nav aria-label={`${label} pages`} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-16)', marginTop: 'var(--space-12)' }}>
      <span>{total ? `${((page - 1) * CONTACT_PAGE_SIZE + 1).toLocaleString()}–${Math.min(page * CONTACT_PAGE_SIZE,total).toLocaleString()} of ${total.toLocaleString()}` : 'No matching contacts'} · Page {page} of {pages}</span>
      {page > 1 && <Link href={href(page - 1)}>Previous page</Link>}
      {page < pages && <Link href={href(page + 1)}>Next page</Link>}
    </nav>
  </section>;
}
