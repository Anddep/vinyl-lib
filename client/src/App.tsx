import { useEffect, useState } from 'react';
import { getHealth, type HealthResponse } from './api/client';

type Status =
  | { kind: 'loading' }
  | { kind: 'success'; data: HealthResponse }
  | { kind: 'error'; message: string };

export default function App() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    getHealth()
      .then((data) => setStatus({ kind: 'success', data }))
      .catch((error: unknown) =>
        setStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      );
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '4rem auto' }}>
      <h1>vinyl-lib</h1>
      <p>For your collection vinyl&apos;s.</p>

      <section
        style={{
          marginTop: '2rem',
          padding: '1rem',
          borderRadius: 8,
          border: '1px solid #ddd',
        }}
      >
        <h2>API health check</h2>
        {status.kind === 'loading' && <p>Checking connection to the server and database...</p>}
        {status.kind === 'success' && (
          <p style={{ color: 'green' }}>
            ✓ Server responded with status &quot;{status.data.status}&quot; and database is{' '}
            {status.data.db}. Client → server → database round trip works.
          </p>
        )}
        {status.kind === 'error' && (
          <p style={{ color: 'crimson' }}>✗ Health check failed: {status.message}</p>
        )}
      </section>
    </main>
  );
}
