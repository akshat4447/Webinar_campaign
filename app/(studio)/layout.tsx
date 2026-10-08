import { Sidebar } from '@/components/Sidebar';
import { ChatWidget } from '@/components/ChatWidget';
import { db } from '@/lib/db';

// The internal Studio shell: sidebar + page area + assistant. Public pages (attendee registration,
// the confirmation hub) live in the (public) group and deliberately do NOT get any of this.
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export default async function StudioLayout({ children }: LayoutProps<'/'>) {
  let totalCount = 0;
  let liveCount = 0;
  let draftCount = 0;
  let completedCount = 0;

  try {
    [totalCount, liveCount, draftCount, completedCount] = await Promise.all([
      db.campaign.count({ where: { archived: false } }),
      db.campaign.count({ where: { archived: false, status: 'live' } }),
      db.campaign.count({ where: { archived: false, status: 'draft' } }),
      db.campaign.count({ where: { archived: false, status: 'completed' } }),
    ]);
  } catch {
    // Database connection may not be available during static build / prerender
  }

  return (
    <>
      <div className="lsq-shell lsq-home-shell">
        <Sidebar totalCount={totalCount} liveCount={liveCount} draftCount={draftCount} completedCount={completedCount} />
        <div className="lsq-home-content">{children}</div>
      </div>
      <ChatWidget />
    </>
  );
}
