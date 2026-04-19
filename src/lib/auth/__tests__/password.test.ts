import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../password';

describe('password hashing', () => {
  it('hashes then verifies the same password', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const hash = hashPassword('s3cret-password');
    expect(verifyPassword('s3cret-passwore', hash)).toBe(false);
  });

  it('produces a different hash each time', () => {
    expect(hashPassword('same-password-123')).not.toBe(hashPassword('same-password-123'));
  });

  it('rejects passwords shorter than 8 chars', () => {
    expect(() => hashPassword('short')).toThrow();
  });

  it('returns false for a malformed stored hash', () => {
    expect(verifyPassword('anything', '')).toBe(false);
    expect(verifyPassword('anything', 'not-a-real-hash')).toBe(false);
    expect(verifyPassword('anything', 'scrypt$1$2$3$bad')).toBe(false);
  });
});
