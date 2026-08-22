import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { ChatWidget } from '@/components/ChatWidget';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Campaign Agent — Webinar Intelligence',
  description: 'LeadSquared webinar campaign agent',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const [totalCount, liveCount, draftCount, completedCount] = await Promise.all([
    db.campaign.count(),
    db.campaign.count({ where: { status: 'live' } }),
    db.campaign.count({ where: { status: 'draft' } }),
    db.campaign.count({ where: { status: 'completed' } }),
  ]);

  return (
    <html lang="en">
      <body>
        <div style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', background: 'var(--surface-page)' }}>
          <Sidebar totalCount={totalCount} liveCount={liveCount} draftCount={draftCount} completedCount={completedCount} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
            {children}
          </div>
        </div>
        <ChatWidget />
      </body>
    </html>
  );
}
