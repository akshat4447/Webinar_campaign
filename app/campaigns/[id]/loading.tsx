// Wraps every stage page (setup/scoring/templates/personalize/schedule/control/
// dashboard) in a Suspense boundary — previously there was no loading.tsx
// anywhere in the app, so a slow query (or a Claude call blocking a page's
// initial render) left the browser on a blank/frozen tab with zero feedback.
export default function CampaignLoading() {
  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              background: '#fff',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-card)',
              padding: '18px 20px',
              height: i === 0 ? 120 : 72,
            }}
          >
            <div style={{ width: '40%', height: 14, borderRadius: 4, background: 'var(--n20)', marginBottom: 10 }} />
            <div style={{ width: '70%', height: 10, borderRadius: 4, background: 'var(--n10)' }} />
          </div>
        ))}
      </div>
    </main>
  );
}
