import { beforeEach, describe, expect, it, vi } from 'vitest';

// Backing store for the mocked settings module. The real module reads from
// SQLite; here we stub it with an in-memory map so session tests stay fast
// and isolated from the database layer.
const store = new Map<string, string>();

vi.mock('@/lib/config', () => ({
  getSetting: (key: string) => store.get(key) ?? '',
  saveSettings: (patch: Record<string, string>) => {
    for (const [k, v] of Object.entries(patch)) store.set(k, v);
  },
}));

import {
  createSessionToken,
  rotateSessionSecret,
  verifySessionToken,
} from '../session';

beforeEach(() => {
  store.clear();
});

describe('session tokens', () => {
  it('round-trips a freshly issued token', () => {
    const token = createSessionToken();
    expect(verifySessionToken(token)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const token = createSessionToken();
    const [payload, sig] = token.split('.');
    const tampered = `${payload}x.${sig}`;
    expect(verifySessionToken(tampered)).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const token = createSessionToken();
    const [payload, sig] = token.split('.');
    const tampered = `${payload}.${sig.slice(0, -2)}aa`;
    expect(verifySessionToken(tampered)).toBe(false);
  });

  it('rejects null / empty tokens', () => {
    expect(verifySessionToken(null)).toBe(false);
    expect(verifySessionToken('')).toBe(false);
    expect(verifySessionToken('onlyonepart')).toBe(false);
  });

  it('invalidates old tokens when the secret rotates', () => {
    const token = createSessionToken();
    expect(verifySessionToken(token)).toBe(true);
    rotateSessionSecret();
    expect(verifySessionToken(token)).toBe(false);
  });
});
