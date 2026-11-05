// The browser-storage choice and the account-level consent record.
//
// Two separate things live here, and they are deliberately not the same state:
//
//   * `privacyChoice` is a DEVICE preference (it survives sign-out, like `theme`).
//     It records whether this browser accepted the optional third-party live chat,
//     and which version of the notice it answered. It holds no identity.
//   * The account consent is recorded server-side on `profiles`
//     (privacy_consent_version / privacy_consented_at) by record_privacy_consent(),
//     so the manuscript can state that a version and a timestamp exist per account.
//
// Nothing in this module writes storage itself: the app state owns the device
// preference and src/lib/auth.js owns the server write, so both stay testable.

import { PRIVACY_NOTICE_VERSION } from './legalDocs';

// The categories the notice offers. `necessary` is required for the site to work
// (a signed-in session and the app's own working record), so it cannot be turned
// off and needs no permission; the live chat is the only optional one, because it
// is the only third party that can set a cookie.
export const CONSENT_CATEGORIES = [
  {
    key: 'necessary',
    label: 'Sign-in and session storage',
    description: 'Keeps you signed in, holds your working record for this session, and runs the idle and total session limits. Required for the site to work.',
    locked: true,
  },
  {
    key: 'supportChat',
    label: 'Live chat (tawk.to)',
    description: 'Loads the third-party live-chat widget when a deployment is configured for it instead of the in-app Support inbox. It can set cookies and identifies the chat with your name and email while you are signed in.',
    locked: false,
    requiresChatWidget: true,
  },
];

export const OPTIONAL_CONSENT_CATEGORIES = CONSENT_CATEGORIES.filter((category) => !category.locked);

export const createDefaultConsentChoice = () => ({
  version: '',
  decidedAt: null,
  supportChat: false,
});

// Total by design: a corrupt, missing, or older record must never break the app,
// and an unreadable value reads as "not answered yet" so the notice is shown again.
export const normalizeConsentChoice = (stored) => {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return createDefaultConsentChoice();
  }

  return {
    version: typeof stored.version === 'string' ? stored.version : '',
    decidedAt: typeof stored.decidedAt === 'string' && stored.decidedAt ? stored.decidedAt : null,
    // Strictly `true`: anything else is treated as not granted.
    supportChat: stored.supportChat === true,
  };
};

export const hasCurrentNotice = (choice, version = PRIVACY_NOTICE_VERSION) => (
  normalizeConsentChoice(choice).version === version
);

// `supportChat` is ignored unless the optional category exists in this build.
export const buildConsentChoice = ({ supportChat = false } = {}, { version = PRIVACY_NOTICE_VERSION, now = new Date() } = {}) => ({
  version,
  decidedAt: now.toISOString(),
  supportChat: supportChat === true,
});

export const acceptAllCategories = (options) => buildConsentChoice({ supportChat: true }, options);
export const acceptNecessaryOnly = (options) => buildConsentChoice({ supportChat: false }, options);

// A category is allowed when it is required, or when the stored choice granted it.
export const isCategoryAllowed = (choice, key) => {
  const category = CONSENT_CATEGORIES.find((entry) => entry.key === key);
  if (!category) return false;
  if (category.locked) return true;
  return normalizeConsentChoice(choice)[key] === true;
};

// The categories a notice should list for this build: the live chat is only worth
// offering when the deployment is actually configured to use it, because the
// in-app inbox loads no third party at all.
export const getConsentCategories = ({ chatWidgetConfigured = false } = {}) => (
  CONSENT_CATEGORIES.filter((category) => !category.requiresChatWidget || chatWidgetConfigured)
);

// What Settings reads back, in the same order the notice offers it.
export const describeConsentChoices = (choice) => {
  const normalized = normalizeConsentChoice(choice);
  return {
    version: normalized.version,
    decidedAt: normalized.decidedAt,
    answered: Boolean(normalized.version),
    current: normalized.version === PRIVACY_NOTICE_VERSION,
    items: CONSENT_CATEGORIES.map((category) => ({
      key: category.key,
      label: category.label,
      allowed: category.locked ? true : normalized[category.key] === true,
      locked: Boolean(category.locked),
    })),
  };
};

// The live-chat gate. src/lib/supportChat.js refuses to load the third-party widget
// until this passes, so the notice is the only way that widget can ever run.
export const canLoadSupportChat = (choice) => isCategoryAllowed(choice, 'supportChat');
