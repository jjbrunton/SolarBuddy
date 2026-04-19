import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '@/lib/db';

export interface ApiKeyRow {
  key_hash: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ApiKeySummary {
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

const KEY_PREFIX = 'sb_live_';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// Keys are 32 random bytes (256 bits) rendered as hex, prefixed so they're
// easy to identify in logs and secret scanners. The full key is only ever
// returned once at creation; we persist only the sha256 and a short display
// prefix. sha256 is fine here because the key already carries 256 bits of
// entropy — no salt or KDF needed.
export function generateApiKey(name: string): { key: string; summary: ApiKeySummary } {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('API key name is required');

  const raw = randomBytes(32).toString('hex');
  const key = `${KEY_PREFIX}${raw}`;
  const prefix = `${KEY_PREFIX}${raw.slice(0, 6)}`;
  const key_hash = sha256(key);
  const created_at = new Date().toISOString();

  const db = getDb();
  db.prepare(
    'INSERT INTO api_keys (key_hash, name, prefix, created_at, last_used_at) VALUES (?, ?, ?, ?, NULL)',
  ).run(key_hash, trimmed, prefix, created_at);

  return { key, summary: { name: trimmed, prefix, created_at, last_used_at: null } };
}

export function listApiKeys(): ApiKeySummary[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT name, prefix, created_at, last_used_at FROM api_keys ORDER BY created_at DESC')
    .all() as ApiKeySummary[];
  return rows;
}

export function revokeApiKey(prefix: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM api_keys WHERE prefix = ?').run(prefix);
  return result.changes > 0;
}

export function verifyApiKey(key: string | undefined | null): boolean {
  if (!key || !key.startsWith(KEY_PREFIX)) return false;
  const db = getDb();
  const row = db
    .prepare('SELECT key_hash FROM api_keys WHERE key_hash = ?')
    .get(sha256(key)) as { key_hash: string } | undefined;
  if (!row) return false;
  // Fire-and-forget last_used_at update; no await since proxy must stay fast.
  try {
    db.prepare('UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?').run(
      new Date().toISOString(),
      row.key_hash,
    );
  } catch {
    // Non-fatal — telemetry only.
  }
  return true;
}

export function extractApiKey(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (auth) {
    const match = /^Bearer\s+(\S+)/i.exec(auth);
    if (match) return match[1];
  }
  return request.headers.get('x-api-key');
}
