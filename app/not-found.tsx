import Link from 'next/link';

export default function NotFound() {
  return (
    <main
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
        background: 'var(--surface-page)',
      }}
    >
      <div
        className="lsq-card"
        style={{
          textAlign: 'center',
          maxWidth: 440,
          padding: '40px 32px',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div
          style={{
            fontSize: '48px',
            fontWeight: 800,
            color: 'var(--accent-600)',
            lineHeight: 1,
            marginBottom: 12,
          }}
        >
          404
        </div>
        <h1
          style={{
            fontSize: 'var(--fs-heading-3)',
            fontWeight: 700,
            color: 'var(--n90)',
            marginBottom: 8,
          }}
        >
          Page not found
        </h1>
        <p
          style={{
            fontSize: 'var(--fs-label-1)',
            color: 'var(--n60)',
            marginBottom: 24,
            lineHeight: 1.5,
          }}
        >
          The page or webinar you are looking for doesn’t exist, has been archived, or was moved.
        </p>
        <Link
          href="/"
          className="lsq-btn lsq-btn--primary"
          style={{ textDecoration: 'none', display: 'inline-flex', padding: '10px 24px' }}
        >
          Back to webinars
        </Link>
      </div>
    </main>
  );
}
