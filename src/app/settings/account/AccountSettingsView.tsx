'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, inputClass, SettingsSection } from '@/components/settings/shared';

interface ApiKeySummary {
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
  username: string | null;
}

export default function AccountSettingsView() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);

  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMessage, setPwMessage] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<{ key: string; prefix: string } | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    const res = await fetch('/api/auth/api-keys');
    if (res.ok) {
      const data = (await res.json()) as { keys: ApiKeySummary[] };
      setKeys(data.keys);
    }
  }, []);

  useEffect(() => {
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ configured: false, authenticated: false, username: null }));
    loadKeys();
  }, [loadKeys]);

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setPwMessage(null);
    setPwError(null);
    if (newPw.length < 8) {
      setPwError('New password must be at least 8 characters');
      return;
    }
    if (newPw !== confirmPw) {
      setPwError('Passwords do not match');
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ new_password: newPw }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setPwError(body.error ?? 'Update failed');
        return;
      }
      setPwMessage('Password updated. Other sessions have been signed out.');
      setNewPw('');
      setConfirmPw('');
    } finally {
      setPwSaving(false);
    }
  }

  async function createKey(event: React.FormEvent) {
    event.preventDefault();
    setKeyError(null);
    setJustCreated(null);
    if (!newKeyName.trim()) {
      setKeyError('Name is required');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/auth/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        key?: string;
        summary?: ApiKeySummary;
      };
      if (!res.ok || !body.ok || !body.key || !body.summary) {
        setKeyError(body.error ?? 'Failed to create key');
        return;
      }
      setJustCreated({ key: body.key, prefix: body.summary.prefix });
      setNewKeyName('');
      await loadKeys();
    } finally {
      setCreating(false);
    }
  }

  async function revoke(prefix: string) {
    if (!confirm(`Revoke API key ${prefix}? Any system using it will lose access immediately.`)) return;
    const res = await fetch(`/api/auth/api-keys/${encodeURIComponent(prefix)}`, { method: 'DELETE' });
    if (res.ok) await loadKeys();
  }

  return (
    <div className="space-y-6">
      <Card>
        <SettingsSection
          title="Account"
          description="The single administrator account used to sign in to SolarBuddy."
        >
          <Field label="Username">
            <div className="text-sm text-sb-text">{status?.username ?? '—'}</div>
          </Field>
        </SettingsSection>
      </Card>

      <Card>
        <SettingsSection
          title="Change password"
          description="Set a new password. Changing it signs out every other session."
        >
          <form onSubmit={changePassword} className="space-y-4">
            <Field label="New password" description="At least 8 characters.">
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                className={inputClass}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
              />
            </Field>
            <Field label="Confirm new password">
              <input
                type="password"
                autoComplete="new-password"
                required
                className={inputClass}
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-4">
              <Button type="submit" disabled={pwSaving}>
                {pwSaving ? 'Updating…' : 'Update password'}
              </Button>
              {pwMessage && <span className="text-sm text-sb-success">{pwMessage}</span>}
              {pwError && <span className="text-sm text-sb-danger">{pwError}</span>}
            </div>
          </form>
        </SettingsSection>
      </Card>

      <Card>
        <SettingsSection
          title="API keys"
          description="Give external systems (Home Assistant, scripts) scoped access to SolarBuddy endpoints. Send as `Authorization: Bearer <key>` or `X-API-Key: <key>`."
        >
          <form onSubmit={createKey} className="space-y-4">
            <Field label="Name" description="A label to help you identify this key later (e.g. 'Home Assistant').">
              <input
                type="text"
                required
                className={inputClass}
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Home Assistant"
              />
            </Field>
            <div className="flex flex-wrap items-center gap-4">
              <Button type="submit" disabled={creating}>
                {creating ? 'Creating…' : 'Create API key'}
              </Button>
              {keyError && <span className="text-sm text-sb-danger">{keyError}</span>}
            </div>
          </form>

          {justCreated && (
            <div className="mt-5 rounded-md border border-sb-ember bg-sb-card p-4">
              <p className="mb-2 text-sm font-semibold text-sb-ember">
                Copy this key now — it won&rsquo;t be shown again.
              </p>
              <code className="block break-all rounded bg-sb-surface-muted p-3 text-xs text-sb-text">
                {justCreated.key}
              </code>
            </div>
          )}

          <div className="mt-6 space-y-2">
            {keys === null ? (
              <p className="text-sm text-sb-text-muted">Loading…</p>
            ) : keys.length === 0 ? (
              <p className="text-sm text-sb-text-muted">No API keys yet.</p>
            ) : (
              <ul className="divide-y divide-sb-border">
                {keys.map((k) => (
                  <li key={k.prefix} className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-sm text-sb-text">{k.name}</div>
                      <div className="text-xs text-sb-text-muted">
                        <code>{k.prefix}…</code>
                        <span className="ml-3">created {new Date(k.created_at).toLocaleString()}</span>
                        {k.last_used_at && (
                          <span className="ml-3">
                            last used {new Date(k.last_used_at).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button variant="danger" size="sm" onClick={() => revoke(k.prefix)}>
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SettingsSection>
      </Card>
    </div>
  );
}
