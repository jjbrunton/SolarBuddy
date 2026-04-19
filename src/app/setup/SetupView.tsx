'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SetupView() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (username.trim().length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 400 && body.error === 'Setup already complete') {
          router.replace('/login');
          return;
        }
        setError(body.error ?? 'Setup failed');
        return;
      }
      router.replace('/');
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
          <h1 className="text-xl text-sb-text">Welcome to SolarBuddy</h1>
          <p className="text-sm text-sb-muted">Create your admin account to get started.</p>
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
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-sb-border bg-sb-bg px-3 py-2 text-sb-text outline-none focus:border-sb-accent"
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="text-sb-muted">Confirm password</span>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
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
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
