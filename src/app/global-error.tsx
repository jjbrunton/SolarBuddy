'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1d23', color: '#e1e4e8', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>Something went wrong</h2>
          <p style={{ fontSize: '0.875rem', color: '#8b949e' }}>
            {error.message || 'A critical error occurred.'}
          </p>
          <button
            onClick={reset}
            style={{ padding: '0.5rem 1rem', borderRadius: '0.375rem', backgroundColor: '#5d9cec', color: 'white', border: 'none', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
