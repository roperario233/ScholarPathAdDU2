import { describe, expect, it } from 'vitest';
import {
  acceptAllCategories,
  acceptNecessaryOnly,
  buildConsentChoice,
  canLoadSupportChat,
  CONSENT_CATEGORIES,
  createDefaultConsentChoice,
  describeConsentChoices,
  getConsentCategories,
  hasCurrentNotice,
  isCategoryAllowed,
  normalizeConsentChoice,
  OPTIONAL_CONSENT_CATEGORIES,
} from '../src/lib/privacyConsent';
import { PRIVACY_NOTICE_VERSION } from '../src/lib/legalDocs';

describe('browser storage choice', () => {
  it('starts unanswered, so the notice is shown', () => {
    const choice = createDefaultConsentChoice();

    expect(choice).toEqual({ version: '', decidedAt: null, supportChat: false });
    expect(hasCurrentNotice(choice)).toBe(false);
    // Required storage is allowed without permission; the live chat is not.
    expect(isCategoryAllowed(choice, 'necessary')).toBe(true);
    expect(isCategoryAllowed(choice, 'supportChat')).toBe(false);
    expect(canLoadSupportChat(choice)).toBe(false);
  });

  it('is tolerant of anything a stored record could hold', () => {
    [null, undefined, 'yes', 42, [], true].forEach((stored) => {
      expect(normalizeConsentChoice(stored)).toEqual(createDefaultConsentChoice());
    });

    // Anything not strictly `true` counts as not granted, and a bad version is blank.
    expect(normalizeConsentChoice({ version: 5, decidedAt: 12, supportChat: 'true' }))
      .toEqual({ version: '', decidedAt: null, supportChat: false });
    expect(normalizeConsentChoice({ version: '2026-11-1', supportChat: true }))
      .toEqual({ version: '2026-11-1', decidedAt: null, supportChat: true });
  });

  it('records the two answers the notice offers', () => {
    const all = acceptAllCategories();
    expect(all.version).toBe(PRIVACY_NOTICE_VERSION);
    expect(hasCurrentNotice(all)).toBe(true);
    expect(isCategoryAllowed(all, 'supportChat')).toBe(true);
    expect(canLoadSupportChat(all)).toBe(true);
    expect(Number.isNaN(Date.parse(all.decidedAt))).toBe(false);

    const necessaryOnly = acceptNecessaryOnly();
    expect(hasCurrentNotice(necessaryOnly)).toBe(true);
    expect(isCategoryAllowed(necessaryOnly, 'necessary')).toBe(true);
    expect(isCategoryAllowed(necessaryOnly, 'supportChat')).toBe(false);
    expect(canLoadSupportChat(necessaryOnly)).toBe(false);
  });

  it('asks again when the notice version changes', () => {
    const choice = acceptAllCategories();

    expect(hasCurrentNotice(choice, '2027-1-1')).toBe(false);
    expect(buildConsentChoice({ supportChat: true }, { version: '2027-1-1' }).version).toBe('2027-1-1');
  });

  it('refuses a category it does not know', () => {
    const choice = acceptAllCategories();

    expect(isCategoryAllowed(choice, 'analytics')).toBe(false);
    expect(isCategoryAllowed(choice, '')).toBe(false);
  });

  it('offers the live chat only when the build is configured for it', () => {
    expect(getConsentCategories({ chatWidgetConfigured: false }).map((entry) => entry.key))
      .toEqual(['necessary']);
    expect(getConsentCategories({ chatWidgetConfigured: true }).map((entry) => entry.key))
      .toEqual(['necessary', 'supportChat']);
    // The in-app Support inbox loads no third party, so there is nothing to opt into.
    expect(getConsentCategories().some((entry) => entry.requiresChatWidget)).toBe(false);
  });

  it('keeps the required category locked', () => {
    expect(CONSENT_CATEGORIES).toHaveLength(2);
    expect(CONSENT_CATEGORIES.filter((entry) => entry.locked).map((entry) => entry.key)).toEqual(['necessary']);
    expect(OPTIONAL_CONSENT_CATEGORIES.map((entry) => entry.key)).toEqual(['supportChat']);
  });

  it('reads the choice back for Settings', () => {
    const pending = describeConsentChoices(createDefaultConsentChoice());
    expect(pending.answered).toBe(false);
    expect(pending.current).toBe(false);
    expect(pending.items).toEqual([
      { key: 'necessary', label: 'Sign-in and session storage', allowed: true, locked: true },
      { key: 'supportChat', label: 'Live chat (tawk.to)', allowed: false, locked: false },
    ]);

    const decided = describeConsentChoices(acceptAllCategories());
    expect(decided.answered).toBe(true);
    expect(decided.current).toBe(true);
    expect(decided.items.find((item) => item.key === 'supportChat').allowed).toBe(true);
  });
});
