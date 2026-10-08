'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { CampaignCardMenu } from './CampaignCardMenu';
import { NewCampaignButton } from './NewCampaignButton';
import { statusMeta } from '@/lib/demo-data';
import { formatLsqDateTime, timeZoneLabel } from '@/lib/dateFormat';
import {
  campaignCadenceHref,
  campaignLandingHref,
  campaignOverviewHref,
  campaignPrimaryCta,
} from '@/lib/campaignRoutes';

interface CampaignCardItem {
  campaign: {
    id: string;
    name: string;
    vertical: string;
    date: string;
    timezone?: string | null;
    scheduledAt?: Date | string | null;
    createdAt?: Date | string;
    status: string;
    archived: boolean;
    speakerName?: string | null;
    speakers?: Array<{ name: string }>;
    registrations?: number | null;
  };
  stats: Array<{ label: string; value: string | number }>;
}

interface WebinarViewControlsProps {
  cards: CampaignCardItem[];
  currentView: string;
  /** Server-rendered status filter (links), placed at the start of the toolbar. */
  /** Plain data (not JSX): an element array built on the server and passed as a prop trips React's list-key check. */
  statusViews?: { id: string; label: string; href: string; count: number; active: boolean }[];
}

/** `21 Oct 2026 | 03:00 PM IST` in the webinar's own timezone; the legacy free-text date for drafts without a real one. */
function whenLabel(c: CampaignCardItem['campaign']): string {
  if (c.scheduledAt) {
    const d = new Date(c.scheduledAt);
    if (!Number.isNaN(d.getTime())) return `${formatLsqDateTime(d, c.timezone)} ${timeZoneLabel(d, c.timezone)}`;
  }
  return c.date || 'No date set';
}

export function WebinarViewControls({ cards, currentView, statusViews }: WebinarViewControlsProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [search, setSearch] = useState('');
  const [verticalFilter, setVerticalFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'date-asc' | 'date-desc' | 'created-desc' | 'name-asc' | 'reg-desc'>('created-desc');

  // Dynamically extract unique verticals from all cards
  const verticals = useMemo(() => {
    const set = new Set<string>();
    cards.forEach((c) => {
      if (c.campaign.vertical) set.add(c.campaign.vertical);
    });
    return Array.from(set).sort();
  }, [cards]);

  // Filter & Sort
  const processedCards = useMemo(() => {
    const q = search.trim().toLowerCase();

    const filtered = cards.filter(({ campaign: c }) => {
      if (verticalFilter !== 'all' && c.vertical !== verticalFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.vertical.toLowerCase().includes(q) ||
        c.date.toLowerCase().includes(q) ||
        (c.speakerName && c.speakerName.toLowerCase().includes(q)) ||
        (c.speakers && c.speakers.some((s) => s.name.toLowerCase().includes(q)))
      );
    });

    return filtered.sort((a, b) => {
      if (sortBy === 'name-asc') {
        return a.campaign.name.localeCompare(b.campaign.name);
      }
      if (sortBy === 'created-desc') {
        const da = a.campaign.createdAt ? new Date(a.campaign.createdAt).getTime() : 0;
        const db = b.campaign.createdAt ? new Date(b.campaign.createdAt).getTime() : 0;
        return db - da;
      }
      if (sortBy === 'date-asc') {
        const da = a.campaign.scheduledAt ? new Date(a.campaign.scheduledAt).getTime() : 0;
        const db = b.campaign.scheduledAt ? new Date(b.campaign.scheduledAt).getTime() : 0;
        return da - db;
      }
      if (sortBy === 'date-desc') {
        const da = a.campaign.scheduledAt ? new Date(a.campaign.scheduledAt).getTime() : 0;
        const db = b.campaign.scheduledAt ? new Date(b.campaign.scheduledAt).getTime() : 0;
        return db - da;
      }
      if (sortBy === 'reg-desc') {
        const ra = a.campaign.registrations || 0;
        const rb = b.campaign.registrations || 0;
        return rb - ra;
      }
      return 0;
    });
  }, [cards, search, verticalFilter, sortBy]);

  const filtersActive = Boolean(search) || verticalFilter !== 'all';

  return (
    <div className="lsq-stack lsq-stack--lg">
      <div className="lsq-card lsq-card__body lsq-stack">
        {statusViews && (
          <nav aria-label="Filter webinars by status">
            <div className="lsq-segmented lsq-home-views">
              {statusViews.map((v) => (
                <Link key={v.id} href={v.href} aria-current={v.active ? 'page' : undefined}>
                  {v.label} <span className="lsq-home-views__count">({v.count.toLocaleString()})</span>
                </Link>
              ))}
            </div>
          </nav>
        )}
        <div className="lsq-toolbar">
          <div className="lsq-toolbar__group lsq-grow">
            <div className="lsq-search">
              <Icon name="search" size={16} />
              <input
                type="search"
                className="lsq-input"
                aria-label="Search webinars"
                placeholder="Search webinars, speakers, topics…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {verticals.length > 0 && (
              <select
                className="lsq-select lsq-home-select"
                aria-label="Filter by vertical"
                value={verticalFilter}
                onChange={(e) => setVerticalFilter(e.target.value)}
              >
                <option value="all">All verticals ({cards.length})</option>
                {verticals.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            )}

            <select
              className="lsq-select lsq-home-select"
              aria-label="Sort webinars"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            >
              <option value="created-desc">Newest created</option>
              <option value="date-asc">Webinar date (upcoming first)</option>
              <option value="date-desc">Webinar date (latest first)</option>
              <option value="name-asc">Name (A to Z)</option>
              <option value="reg-desc">Most registrations</option>
            </select>
          </div>

          <div className="lsq-segmented lsq-home-toggle" role="group" aria-label="Layout">
            <button type="button" aria-pressed={viewMode === 'grid'} aria-label="Card view" title="Card view" onClick={() => setViewMode('grid')}>
              <Icon name="grid" size={16} />
            </button>
            <button type="button" aria-pressed={viewMode === 'table'} aria-label="List view" title="List view" onClick={() => setViewMode('table')}>
              <Icon name="list" size={16} />
            </button>
          </div>
        </div>
      </div>

      {processedCards.length === 0 && (
        <div className="lsq-card">
          <div className="lsq-empty">
            <span className="lsq-empty__icon" aria-hidden="true">
              <Icon name={filtersActive ? 'search' : 'document'} size={32} />
            </span>
            {filtersActive ? (
              <>
                <h2 className="lsq-empty__title">No Webinars Match</h2>
                <p className="lsq-empty__body">Nothing in this view matches the current search or vertical filter.</p>
                <Button
                  hierarchy="secondary"
                  size="sm"
                  onClick={() => {
                    setSearch('');
                    setVerticalFilter('all');
                  }}
                >
                  Clear Filters
                </Button>
              </>
            ) : currentView === 'archived' ? (
              <>
                <h2 className="lsq-empty__title">No Archived Webinars</h2>
                <p className="lsq-empty__body">Archived webinars appear here and can be restored at any time.</p>
              </>
            ) : currentView === 'all' ? (
              <>
                <h2 className="lsq-empty__title">No Webinars Yet</h2>
                <p className="lsq-empty__body">Create a webinar to start building an audience and a cadence.</p>
                <NewCampaignButton />
              </>
            ) : (
              <>
                <h2 className="lsq-empty__title">No Webinars Here</h2>
                <p className="lsq-empty__body">No webinars match this status filter.</p>
              </>
            )}
          </div>
        </div>
      )}

      {viewMode === 'grid' && processedCards.length > 0 && (
        <ul className="lsq-home-grid" aria-label="Webinars">
          {processedCards.map(({ campaign: c, stats }) => {
            const meta = statusMeta[c.status as keyof typeof statusMeta] ?? statusMeta.draft;
            return (
              <li key={c.id}>
                <article className="lsq-card lsq-home-card" aria-labelledby={`wc-${c.id}`}>
                  <div className="lsq-home-card__top">
                    <Badge color={meta.color} text={meta.label} dot />
                    <span className="lsq-home-card__vertical">{c.vertical}</span>
                    <CampaignCardMenu campaignId={c.id} campaignName={c.name} archived={c.archived} />
                  </div>

                  <div>
                    <h2 className="lsq-home-card__name" id={`wc-${c.id}`}>
                      <Link href={campaignLandingHref(c)}>{c.name}</Link>
                    </h2>
                    <p className="lsq-home-card__when">
                      <Icon name="calendar" size={14} />
                      <span>{whenLabel(c)}</span>
                      {c.speakerName ? <span>{`· ${c.speakerName}`}</span> : null}
                    </p>
                  </div>

                  <dl className="lsq-home-card__stats">
                    {stats.map((s) => (
                      <div key={s.label} className="lsq-home-card__stat">
                        <dt>{s.label}</dt>
                        <dd data-text={typeof s.value === 'string' && !/^[\d.,%—\s]+$/.test(s.value) ? 'true' : undefined}>
                          {typeof s.value === 'number' ? s.value.toLocaleString() : s.value}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <div className="lsq-home-card__actions">
                    <Link href={campaignLandingHref(c)} className="lsq-btn lsq-btn--sm lsq-btn--primary lsq-home-linkbtn">
                      {campaignPrimaryCta(c.status)}
                    </Link>
                    <Link href={campaignOverviewHref(c.id)} className="lsq-btn lsq-btn--sm lsq-btn--secondary lsq-home-linkbtn">
                      Overview
                    </Link>
                    <Link href={campaignCadenceHref(c.id)} className="lsq-btn lsq-btn--sm lsq-btn--secondary lsq-home-linkbtn">
                      Cadence
                    </Link>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {viewMode === 'table' && processedCards.length > 0 && (
        <div className="lsq-card">
          <div className="lsq-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
            <table className="lsq-table lsq-home-table">
              <caption className="lsq-sr-only">Webinars</caption>
              <thead>
                <tr>
                  <th scope="col">Webinar</th>
                  <th scope="col">Vertical</th>
                  <th scope="col">Date</th>
                  <th scope="col">Status</th>
                  <th scope="col">Key numbers</th>
                  <th scope="col" className="lsq-home-th-actions">Next action</th>
                </tr>
              </thead>
              <tbody>
                {processedCards.map(({ campaign: c, stats }) => {
                  const meta = statusMeta[c.status as keyof typeof statusMeta] ?? statusMeta.draft;
                  return (
                    <tr key={c.id}>
                      <td className="lsq-cell-primary">
                        <Link href={campaignLandingHref(c)} className="lsq-home-rowlink">
                          {c.name}
                        </Link>
                        {c.speakerName && <div className="lsq-cell-secondary">{c.speakerName}</div>}
                      </td>
                      <td className="lsq-cell-secondary lsq-home-nowrap">{c.vertical}</td>
                      <td className="lsq-cell-secondary lsq-home-nowrap">{whenLabel(c)}</td>
                      <td>
                        <Badge color={meta.color} text={meta.label} dot />
                      </td>
                      <td>
                        <ul className="lsq-chips lsq-home-chiplist">
                          {stats.map((s) => (
                            <li key={s.label} className="lsq-chip">
                              {s.label} <strong>{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</strong>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td>
                        <div className="lsq-home-rowactions">
                          <Link href={campaignLandingHref(c)} className="lsq-btn lsq-btn--sm lsq-btn--primary lsq-home-linkbtn">
                            {campaignPrimaryCta(c.status)}
                          </Link>
                          <Link href={campaignOverviewHref(c.id)} className="lsq-btn lsq-btn--sm lsq-btn--secondary lsq-home-linkbtn">
                            Overview
                          </Link>
                          <CampaignCardMenu campaignId={c.id} campaignName={c.name} archived={c.archived} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
