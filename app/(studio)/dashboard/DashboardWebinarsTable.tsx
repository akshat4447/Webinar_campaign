'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { statusMeta } from '@/lib/demo-data';
import { campaignLandingHref } from '@/lib/campaignRoutes';
import { DASH } from '@/lib/analyticsMath';

export interface WebinarSummaryItem {
  id: string;
  name: string;
  date: string;
  timestamp?: number;
  status: string;
  registered: number;
  attendanceRate: string;
  demoRequests: number;
}

interface DashboardWebinarsTableProps {
  webinars: WebinarSummaryItem[];
  /** True count matching the selected range — `webinars` itself is capped
   *  server-side, so this may be larger than webinars.length. */
  totalCount: number;
  /** The dashboard's date window ("Last 30 days"), shown so this table is never read as all-time. */
  windowLabel?: string;
}

type SortField = 'name' | 'date' | 'status' | 'registered' | 'attendance' | 'demos';

const COLUMNS: { field: SortField; label: string; numeric?: boolean }[] = [
  { field: 'name', label: 'Webinar' },
  { field: 'date', label: 'Date' },
  { field: 'status', label: 'Status' },
  { field: 'registered', label: 'Registered', numeric: true },
  { field: 'attendance', label: 'Attendance', numeric: true },
  { field: 'demos', label: 'Demos', numeric: true },
];

export function DashboardWebinarsTable({ webinars, totalCount, windowLabel }: DashboardWebinarsTableProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField>('registered');
  const [sortAsc, setSortAsc] = useState(false);

  const statuses = useMemo(() => {
    const set = new Set<string>();
    webinars.forEach((w) => {
      if (w.status) set.add(w.status);
    });
    return Array.from(set);
  }, [webinars]);

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = webinars.filter((w) => {
      if (statusFilter !== 'all' && w.status !== statusFilter) return false;
      if (!q) return true;
      return w.name.toLowerCase().includes(q) || w.date.toLowerCase().includes(q);
    });

    return filtered.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortField === 'date') {
        cmp = (a.timestamp ?? 0) - (b.timestamp ?? 0) || a.date.localeCompare(b.date);
      } else if (sortField === 'status') {
        cmp = a.status.localeCompare(b.status);
      } else if (sortField === 'registered') {
        cmp = a.registered - b.registered;
      } else if (sortField === 'attendance') {
        const rateA = parseFloat(a.attendanceRate) || 0;
        const rateB = parseFloat(b.attendanceRate) || 0;
        cmp = rateA - rateB;
      } else if (sortField === 'demos') {
        cmp = a.demoRequests - b.demoRequests;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [webinars, search, statusFilter, sortField, sortAsc]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(false); // Default to descending for numbers
    }
  };

  // Totals for filtered list
  const totalRegistered = useMemo(() => {
    return filteredAndSorted.reduce((acc, w) => acc + w.registered, 0);
  }, [filteredAndSorted]);

  const totalDemos = useMemo(() => {
    return filteredAndSorted.reduce((acc, w) => acc + w.demoRequests, 0);
  }, [filteredAndSorted]);

  const capped = totalCount > webinars.length;

  return (
    <section className="lsq-card" aria-labelledby="dash-webinars">
      <div className="lsq-card__header">
        <div>
          <h2 className="lsq-card__title" id="dash-webinars">Webinars in Range</h2>
          <p className="lsq-card__sub">
            {windowLabel ? `${windowLabel}. ` : ''}
            {filteredAndSorted.length.toLocaleString()} of {webinars.length.toLocaleString()} {webinars.length === 1 ? 'webinar' : 'webinars'} shown
            {capped ? `. This is the latest ${webinars.length.toLocaleString()} of ${totalCount.toLocaleString()} in the window, so the total row sums the listed webinars only` : ''}.
          </p>
        </div>
        <div className="lsq-home-tabletools">
          <div className="lsq-search">
            <Icon name="search" size={16} />
            <input
              type="search"
              className="lsq-input"
              aria-label="Search webinars in range"
              placeholder="Search webinars…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="lsq-segmented" role="group" aria-label="Filter by status">
            <button type="button" aria-pressed={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
              All
            </button>
            {statuses.map((st) => {
              const meta = statusMeta[st as keyof typeof statusMeta] ?? { label: st };
              return (
                <button key={st} type="button" aria-pressed={statusFilter === st} onClick={() => setStatusFilter(st)}>
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {filteredAndSorted.length === 0 ? (
        <div className="lsq-empty">
          <span className="lsq-empty__icon" aria-hidden="true">
            <Icon name="search" size={32} />
          </span>
          <p className="lsq-empty__title">{search || statusFilter !== 'all' ? 'No Webinars Match' : 'No Webinars in This Window'}</p>
          <p className="lsq-empty__body">
            {search || statusFilter !== 'all' ? 'Nothing in this window matches the current search or status filter.' : 'Webinars scheduled or created within the selected date range appear here.'}
          </p>
        </div>
      ) : (
        <div className="lsq-table-wrap lsq-home-tablewrap">
          <table className="lsq-table lsq-home-table">
            <thead>
              <tr>
                {COLUMNS.map((col) => {
                  const active = sortField === col.field;
                  return (
                    <th
                      key={col.field}
                      scope="col"
                      className={col.numeric ? 'num' : undefined}
                      aria-sort={active ? (sortAsc ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" className="lsq-home-sort" onClick={() => handleSort(col.field)}>
                        {col.label}
                        <Icon name={active ? (sortAsc ? 'arrow-up' : 'arrow-down') : 'sort'} size={12} />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.map((w) => {
                const meta = statusMeta[w.status as keyof typeof statusMeta] ?? statusMeta.draft;
                return (
                  <tr key={w.id}>
                    <td className="lsq-cell-primary">
                      <Link href={campaignLandingHref(w)} className="lsq-home-rowlink">
                        {w.name}
                      </Link>
                    </td>
                    <td className="lsq-cell-secondary lsq-home-nowrap">{w.date}</td>
                    <td>
                      <Badge color={meta.color} text={meta.label} dot />
                    </td>
                    <td className="num lsq-cell-primary">{w.registered.toLocaleString()}</td>
                    <td className="num">{w.attendanceRate}</td>
                    <td className="num">{w.demoRequests ? w.demoRequests.toLocaleString() : DASH}</td>
                  </tr>
                );
              })}
            </tbody>
            {filteredAndSorted.length > 1 && (
              <tfoot>
                <tr>
                  <td colSpan={3}>Total ({filteredAndSorted.length.toLocaleString()} webinars listed)</td>
                  <td className="num">{totalRegistered.toLocaleString()}</td>
                  <td className="num">{DASH}</td>
                  <td className="num">{totalDemos.toLocaleString()}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  );
}
