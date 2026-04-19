import { getSetting } from '@/lib/config';

// The single-user deployment treats "setup complete" as having both a username
// and a stored password hash. No additional user table — credentials live in
// the settings KV so the rest of the runtime can read them via the existing
// config helpers.
export function isAuthConfigured(): boolean {
  const username = getSetting('auth_username').trim();
  const hash = getSetting('auth_password_hash');
  return Boolean(username && hash);
}
