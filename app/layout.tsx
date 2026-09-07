import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { ChatWidget } from '@/components/ChatWidget';
import { ToastProvider } from '@/components/ui/Toast';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Webinar Studio',
  description: 'Run B2B webinar campaigns end to end — audience, messaging, cadence and reporting',
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: LayoutProps<'/'>) {
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
    <html lang="en">
      <body>
        <ToastProvider>
          <div style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', background: 'var(--surface-page)' }}>
            <Sidebar totalCount={totalCount} liveCount={liveCount} draftCount={draftCount} completedCount={completedCount} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
              {children}
            </div>
          </div>
          <ChatWidget />
        </ToastProvider>
      </body>
    </html>
  );
}
