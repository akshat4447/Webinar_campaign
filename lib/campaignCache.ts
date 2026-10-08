import { cache } from 'react';
import { db } from '@/lib/db';

/**
 * Request-scoped memoization (React's `cache()` — see "Reusing data with
 * React.cache" in node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md)
 * for the one unscoped `Campaign` row that otherwise gets fetched
 * independently several times while rendering a campaign's Results tab: the
 * campaigns/[id] layout (header/tabs), the results page itself, and
 * lib/postEvent.ts's getPostEventStats.
 *
 * React's cache() dedupes by argument identity, not semantic equivalence —
 * every call site sharing this must ask for exactly the same thing (the
 * full, unscoped row, keyed only by `id`). A caller that needs a narrower or
 * differently-shaped `select` should keep querying `db.campaign` directly
 * rather than reusing this and silently pulling a wider row than it needs.
 *
 * Throws, like `findUniqueOrThrow`, when the campaign doesn't exist —
 * callers that treat that as a 404 signal (see `app/campaigns/[id]/layout.tsx`)
 * must catch it themselves rather than this module swallowing it.
 */
export const getCachedCampaign = cache(async (id: string) => {
  return db.campaign.findUniqueOrThrow({ where: { id } });
});
