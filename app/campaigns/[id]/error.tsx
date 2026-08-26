'use client';

// Error boundaries must be Client Components (see node_modules/next/dist/docs/
// .../error.md). Previously there was no error.tsx anywhere in the app, so an
// uncaught exception in any stage page (a bad Claude/LeadSquared response, a
// thrown assertion, etc.) surfaced as Next's generic full-page crash screen
// with no way back into the campaign without a manual URL edit.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

export default function CampaignError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const router = useRouter();

  useEffect(() => {
    console.error('Campaign workspace error:', error);
  }, [error]);

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '48px 36px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '28px 24px', maxWidth: 480, textAlign: 'center', height: 'fit-content' }}>
        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--n90)', marginBottom: 8 }}>Something went wrong on this tab</div>
        <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', lineHeight: 1.55, marginBottom: 20, overflowWrap: 'anywhere' }}>
          {error.message || 'An unexpected error interrupted this page.'}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <Button hierarchy="secondary" size="sm" onClick={() => router.push('/')}>
            Back to all webinars
          </Button>
          <Button hierarchy="primary" size="sm" onClick={() => retry()}>
            Try again
          </Button>
        </div>
      </div>
    </main>
  );
}
