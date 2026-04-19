'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginView() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search?.get('next') ?? '/';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.status === 409) {
        router.replace('/setup');
        return;
      }
      if (!res.ok) {
        setError('Invalid username or password');
        return;
      }
      router.replace(next.startsWith('/') ? next : '/');
      router.refresh();
    } catch {
      setError('Network error — try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-lg border border-sb-border bg-sb-panel p-8 shadow-lg"
      >
        <div className="space-y-1 text-center">
          <h1 className="text-xl text-sb-text">SolarBuddy</h1>
          <p className="text-sm text-sb-muted">Sign in to continue</p>
        </div>

        <label className="block space-y-1 text-sm">
          <span className="text-sb-muted">Username</span>
          <input
            type="text"
            required
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-md border border-sb-border bg-sb-bg px-3 py-2 text-sb-text outline-none focus:border-sb-accent"
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="text-sb-muted">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-sb-border bg-sb-bg px-3 py-2 text-sb-text outline-none focus:border-sb-accent"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-sb-accent px-3 py-2 text-sb-bg hover:opacity-90 disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
