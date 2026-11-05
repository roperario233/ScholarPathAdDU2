import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PrivacyConsentBanner from '../src/components/PrivacyConsentBanner';
import PrivacyConsentModal from '../src/components/PrivacyConsentModal';
import LoginScreen from '../src/pages/LoginScreen';
import { acceptAllCategories, acceptNecessaryOnly, createDefaultConsentChoice } from '../src/lib/privacyConsent';
import { PRIVACY_NOTICE_VERSION } from '../src/lib/legalDocs';

const renderBanner = (props = {}) => renderToStaticMarkup(
  <PrivacyConsentBanner
    choice={createDefaultConsentChoice()}
    onDecide={vi.fn()}
    onOpenDocument={vi.fn()}
    chatWidgetConfigured={false}
    {...props}
  />,
);

describe('storage notice banner', () => {
  it('stays hidden once this notice version has been answered', () => {
    expect(renderBanner({ choice: acceptAllCategories() })).toBe('');
    expect(renderBanner({ choice: acceptNecessaryOnly() })).toBe('');
  });

  it('returns when a stored choice belongs to an older notice version', () => {
    const html = renderBanner({ choice: { ...acceptAllCategories(), version: '2025-01-1' } });
    expect(html).toContain('Your privacy, in one screen');
  });

  it('offers only acknowledgement when the build has no third party', () => {
    const html = renderBanner();

    expect(html).toContain('Understood');
    expect(html).toContain('What is stored?');
    expect(html).toContain('justify-end gap-2 border-t border-app-border pt-3');
    expect(html).toContain('aria-controls="privacy-storage-details"');
    expect(html).not.toContain('Accept all');
    expect(html).toContain('no advertising, analytics, or third-party cookies');
  });

  it('offers the three notice answers when the live chat is configured', () => {
    const html = renderBanner({ chatWidgetConfigured: true });

    expect(html).toContain('Accept all');
    expect(html).toContain('Necessary only');
    expect(html).toContain('Manage');
    expect(html).toContain('third-party cookies');
  });

  it('links every document', () => {
    const html = renderBanner();

    expect(html).toContain('Privacy Policy');
    expect(html).toContain('Cookie and storage notice');
    expect(html).toContain('Terms of Use');
  });

  it('never blocks the app: it is a non-modal aside', () => {
    const html = renderBanner({ chatWidgetConfigured: true });

    expect(html.startsWith('<aside')).toBe(true);
    expect(html).not.toContain('aria-modal');
  });
});

const renderModal = (props = {}) => renderToStaticMarkup(
  <PrivacyConsentModal
    roleLabel="Student"
    onAccept={vi.fn()}
    onDecline={vi.fn()}
    onOpenDocument={vi.fn()}
    {...props}
  />,
);

describe('account consent card', () => {
  it('withholds the accept action until the notice is accepted', () => {
    const html = renderModal();
    const agree = html.slice(html.indexOf('Agree and continue') - 420, html.indexOf('Agree and continue'));

    expect(html).toContain('How ScholarPath AdDU handles your information');
    expect(html).toContain('I have read and accept the Privacy Policy');
    expect(html).toContain('Sign out instead');
    expect(agree).toContain('disabled');
  });

  it('explains what is collected and recorded', () => {
    const html = renderModal();

    expect(html).toContain('RA 10173');
    expect(html).toContain('Household finances');
    expect(html).toContain(PRIVACY_NOTICE_VERSION);
    expect(html).toContain('Privacy Policy');
    expect(html).toContain('Terms of Use');
  });

  it('reports a failed record attempt instead of closing', () => {
    const html = renderModal({ errorMessage: 'Your consent could not be recorded.' });

    expect(html).toContain('Your consent could not be recorded.');
    expect(html).toContain('role="alert"');
  });

  it('is a dialog with no dismiss control', () => {
    const html = renderModal();

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).not.toContain('>Close<');
  });
});

describe('login screen entry points', () => {
  const renderLogin = () => renderToStaticMarkup(
    <LoginScreen
      onLogin={vi.fn()}
      onSignUp={vi.fn()}
      onForgotPassword={vi.fn()}
      theme="light"
      onToggleTheme={vi.fn()}
      onOpenLegalDocument={vi.fn()}
    />,
  );

  it('links the three documents before sign-in', () => {
    const html = renderLogin();

    expect(html).toContain('Privacy Policy');
    expect(html).toContain('Cookie and storage notice');
    expect(html).toContain('Terms of Use');
    expect(html).toContain('research prototype of Ateneo de Davao University');
  });
});
