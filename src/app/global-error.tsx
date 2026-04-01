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
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background:
            'radial-gradient(circle at top left, rgba(68, 176, 201, 0.14), transparent 30%), linear-gradient(180deg, #0d1920 0%, #08131a 58%)',
          color: '#f2f7fb',
          fontFamily: 'Manrope, system-ui, sans-serif',
          padding: '24px',
        }}
      >
        <div
          style={{
            maxWidth: '640px',
            borderRadius: '28px',
            border: '1px solid rgba(114, 145, 165, 0.16)',
            background: 'rgba(13, 25, 32, 0.82)',
            padding: '32px',
            boxShadow: '0 18px 48px rgba(0, 0, 0, 0.24)',
            textAlign: 'center',
          }}
        >
          <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#6f8492' }}>
            Exception
          </p>
          <h2 style={{ margin: '12px 0 0', fontSize: '2rem', lineHeight: 1.05, fontWeight: 600 }}>
            SolarBuddy hit a critical error
          </h2>
          <p style={{ margin: '12px 0 0', fontSize: '15px', lineHeight: 1.7, color: '#9db1bf' }}>
            {error.message || 'A critical error occurred.'}
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: '20px',
              padding: '10px 16px',
              borderRadius: '14px',
              backgroundColor: '#44b0c9',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
