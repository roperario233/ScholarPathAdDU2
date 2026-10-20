import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAuthRedirectUrl } from '../src/lib/auth';

// Regression guard for the deployed Google sign-in redirect. Supabase Auth falls
// back to the project Site URL (localhost on an unconfigured project) whenever
// the requested redirect is not allow-listed, so the app must always send a
// concrete, allow-listed return URL.
describe('getAuthRedirectUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete globalThis.window;
  });

  it('returns undefined without a browser window', () => {
    expect(globalThis.window).toBeUndefined();
    expect(getAuthRedirectUrl()).toBeUndefined();
  });

  it('falls back to the current origin with a trailing slash', () => {
    globalThis.window = { location: { origin: 'http://localhost:5173' } };
    // A local .env may define the canonical site URL; this case is about the
    // fallback, so clear it explicitly instead of relying on the environment.
    vi.stubEnv('VITE_SITE_URL', '');

    expect(getAuthRedirectUrl()).toBe('http://localhost:5173/');
  });

  it('prefers the configured canonical site URL', () => {
    globalThis.window = { location: { origin: 'http://localhost:5173' } };
    vi.stubEnv('VITE_SITE_URL', 'https://scholarpath-addu.vercel.app');

    expect(getAuthRedirectUrl()).toBe('https://scholarpath-addu.vercel.app/');
  });

  it('keeps an existing trailing slash and trims stray whitespace', () => {
    globalThis.window = { location: { origin: 'http://localhost:5173' } };
    vi.stubEnv('VITE_SITE_URL', '  https://scholarpath-addu.vercel.app/  ');

    expect(getAuthRedirectUrl()).toBe('https://scholarpath-addu.vercel.app/');
  });
});