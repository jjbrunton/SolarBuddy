import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testDb } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE api_keys (
      key_hash    TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      prefix      TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      last_used_at TEXT
    );
  `);
  return { testDb: db };
});

vi.mock('@/lib/db', () => ({ getDb: () => testDb }));

import { generateApiKey, listApiKeys, revokeApiKey, verifyApiKey } from '../api-keys';

beforeEach(() => {
  testDb.exec('DELETE FROM api_keys');
});

describe('api key lifecycle', () => {
  it('creates a key that verifies and is listed', () => {
    const { key, summary } = generateApiKey('Home Assistant');
    expect(key.startsWith('sb_live_')).toBe(true);
    expect(verifyApiKey(key)).toBe(true);
    const keys = listApiKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0].name).toBe('Home Assistant');
    expect(keys[0].prefix).toBe(summary.prefix);
  });

  it('rejects a key with the wrong prefix or unknown hash', () => {
    generateApiKey('scratch');
    expect(verifyApiKey('not-our-format')).toBe(false);
    expect(verifyApiKey('sb_live_deadbeef')).toBe(false);
    expect(verifyApiKey(null)).toBe(false);
    expect(verifyApiKey(undefined)).toBe(false);
  });

  it('revoking a key stops verification', () => {
    const { key, summary } = generateApiKey('temporary');
    expect(verifyApiKey(key)).toBe(true);
    expect(revokeApiKey(summary.prefix)).toBe(true);
    expect(verifyApiKey(key)).toBe(false);
    expect(revokeApiKey(summary.prefix)).toBe(false);
  });

  it('records last_used_at on successful verification', () => {
    const { key } = generateApiKey('tracker');
    expect(listApiKeys()[0].last_used_at).toBeNull();
    verifyApiKey(key);
    expect(listApiKeys()[0].last_used_at).not.toBeNull();
  });

  it('requires a name', () => {
    expect(() => generateApiKey('   ')).toThrow();
  });
});
