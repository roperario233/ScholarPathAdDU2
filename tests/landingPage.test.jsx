// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LandingPage from '../src/pages/LandingPage';
import { createIllustrationAnswers, evaluateIllustration, FAQS, JOURNEY_STEPS, LANDING_FACTS } from '../src/components/landing/content';
import { hasAuthRedirectPayload, shouldSkipLanding } from '../src/lib/landingGate';
import { LEGAL_DOCUMENT_KEYS } from '../src/lib/legalDocs';
import { SCHOLARSHIP_GUIDES } from '../src/lib/scholarshipGuide';
import { sopStages } from '../src/lib/constants';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockMatchMedia = ({ reducedMotion = false } = {}) => {
  window.matchMedia = vi.fn((query) => ({
    matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
};

let container;
let root;

const renderLanding = (props = {}) => {
  const handlers = {
    onGetStarted: vi.fn(),
    onSignIn: vi.fn(),
    onOpenLegalDocument: vi.fn(),
    onToggleTheme: vi.fn(),
  };
  act(() => {
    root.render(<LandingPage theme="dark" {...handlers} {...props} />);
  });
  return handlers;
};

const click = (element) => act(() => {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

const byText = (selector, text) => [...container.querySelectorAll(selector)].find((node) => node.textContent.trim() === text);

beforeEach(() => {
  mockMatchMedia();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root.unmount());
  container.remove();
});

describe('LandingPage', () => {
  it('has exactly one h1, a skip link to main, and the three landmarks', () => {
    renderLanding();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('a.lp-skip').getAttribute('href')).toBe('#lp-main');
    expect(container.querySelector('main#lp-main')).not.toBeNull();
    expect(container.querySelector('header')).not.toBeNull();
    expect(container.querySelector('footer')).not.toBeNull();
  });

  it('leads with "Your AdDU scholarship" and carries no pill above the headline', () => {
    renderLanding();
    expect(container.querySelector('h1').textContent).toBe('Your AdDU scholarship, one clear path.');
    expect(container.textContent).not.toContain('Scholarship workspace');
    expect(container.querySelector('.lp-hero-eyebrow')).toBeNull();
  });

  it('animates the route with a comet and shows the campus photo as decoration only', () => {
    // Motion is on only where an IntersectionObserver exists; jsdom has none.
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
    renderLanding();
    const comet = container.querySelector('.lp-comet-group');
    expect(comet).not.toBeNull();
    expect(comet.querySelectorAll('animate[attributeName="stroke-dashoffset"]')).toHaveLength(3);
    expect(comet.querySelector('animateMotion')).not.toBeNull();
    const campus = container.querySelectorAll('.lp-campus img');
    expect(campus.length).toBeGreaterThan(0);
    campus.forEach((image) => {
      expect(image.getAttribute('alt')).toBe('');
      expect(image.closest('[aria-hidden="true"]')).not.toBeNull();
    });
  });

  it('opens and closes the mobile menu without removing it from the page', () => {
    renderLanding();
    const menu = container.querySelector('#lp-mobile-menu');
    const toggle = container.querySelector('button[aria-controls="lp-mobile-menu"]');
    // Always rendered (so CSS can animate it); closed it is aria-hidden.
    expect(menu).not.toBeNull();
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    expect(menu.classList.contains('is-open')).toBe(false);
    click(toggle);
    expect(menu.getAttribute('aria-hidden')).toBe('false');
    expect(menu.classList.contains('is-open')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    click(toggle);
    expect(menu.classList.contains('is-open')).toBe(false);
  });

  it('closes the mobile menu on a press outside it, but not inside it', () => {
    renderLanding();
    const menu = container.querySelector('#lp-mobile-menu');
    const toggle = container.querySelector('button[aria-controls="lp-mobile-menu"]');
    const press = (target) => act(() => {
      target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    click(toggle);
    expect(menu.classList.contains('is-open')).toBe(true);
    press(menu.querySelector('.lp-mobile-link'));
    expect(menu.classList.contains('is-open')).toBe(true);
    press(container.querySelector('h1'));
    expect(menu.classList.contains('is-open')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('fires the create-account and sign-in handlers from its calls to action', () => {
    const handlers = renderLanding();
    click(container.querySelector('#lp-top .lp-btn--primary'));
    expect(handlers.onGetStarted).toHaveBeenCalledTimes(1);
    click(byText('.lp-hero-actions button', 'Sign in'));
    expect(handlers.onSignIn).toHaveBeenCalledTimes(1);
    click(byText('.lp-header-bar button', 'Sign in'));
    expect(handlers.onSignIn).toHaveBeenCalledTimes(2);
    click(byText('.lp-final button', 'I already have an account'));
    expect(handlers.onSignIn).toHaveBeenCalledTimes(3);
  });

  it('opens each policy document from the footer', () => {
    const handlers = renderLanding();
    const links = container.querySelectorAll('footer .lp-footer-link');
    expect(links).toHaveLength(LEGAL_DOCUMENT_KEYS.length);
    links.forEach((link) => click(link));
    expect(handlers.onOpenLegalDocument.mock.calls.map(([key]) => key)).toEqual(LEGAL_DOCUMENT_KEYS);
  });

  it('toggles a FAQ answer open and closed', () => {
    renderLanding();
    const question = container.querySelector('#lp-faq-q-registrar');
    const answer = container.querySelector('#lp-faq-a-registrar');
    expect(question.getAttribute('aria-expanded')).toBe('false');
    expect(answer.getAttribute('aria-hidden')).toBe('true');
    click(question);
    expect(question.getAttribute('aria-expanded')).toBe('true');
    expect(answer.getAttribute('aria-hidden')).toBe('false');
    expect(question.closest('.lp-faq-item').classList.contains('is-open')).toBe(true);
    expect(answer.textContent).toContain('no registrar integration');
    click(question);
    expect(question.getAttribute('aria-expanded')).toBe('false');
    expect(answer.getAttribute('aria-hidden')).toBe('true');
  });

  it('toggles the WSP program list as a disclosure', () => {
    renderLanding();
    const toggle = container.querySelector('.lp-programs-toggle');
    const panel = container.querySelector('.lp-programs-panel');
    const wrapper = container.querySelector('.lp-programs');
    expect(toggle.textContent).toContain('18 WSP programs');
    expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.getAttribute('aria-hidden')).toBe('false');
    expect(wrapper.classList.contains('is-open')).toBe(true);
    expect(panel.textContent).toContain('Public Management');
    click(toggle);
    expect(wrapper.classList.contains('is-open')).toBe(false);
  });

  it('updates the illustrative checker verdict as answers change', () => {
    renderLanding();
    const verdict = () => container.querySelector('.lp-try-result [role="status"]').textContent;
    expect(verdict()).toContain('Answers needed');
    expect(container.querySelector('#try').textContent).toContain('Illustration');

    click(byText('#try .lp-choice', 'Current or transferee').querySelector('input'));
    const range = container.querySelector('#try input[type="range"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(range, '3.2');
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(byText('#try .lp-choice', 'Up to ₱300,000 a year').querySelector('input'));
    const select = container.querySelector('#try select');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'AB Psychology');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(verdict()).toContain('You qualify');

    click(container.querySelector('#try .lp-switch input'));
    expect(verdict()).toContain('Not eligible yet');
  });

  it('renders every section, finished and visible, under reduced motion', () => {
    mockMatchMedia({ reducedMotion: true });
    renderLanding();
    const page = container.querySelector('.lp');
    expect(page.dataset.motion).toBe('off');
    const text = page.textContent;
    SCHOLARSHIP_GUIDES.forEach((guide) => expect(text).toContain(guide.name));
    JOURNEY_STEPS.forEach((step) => expect(text).toContain(step.title));
    FAQS.forEach((faq) => expect(text).toContain(faq.question));
    expect(container.querySelector('animateMotion')).toBeNull();
    // Count-up figures show their real value without animating.
    expect(container.querySelector('.lp-facts').textContent).toContain(String(LANDING_FACTS[2].value));
  });

  it('never shows a student the stored "Rejected" status', () => {
    renderLanding();
    expect(container.textContent).not.toMatch(/\bRejected\b/);
    expect(container.textContent).toContain('Reverted for resubmission');
    expect(container.textContent).toContain('For Interview');
  });
});

describe('landing content', () => {
  it('counts only real facts', () => {
    expect(LANDING_FACTS.map((fact) => fact.value)).toEqual([3, 5, sopStages.length]);
  });

  it('lets a specific exclusion override every passing answer', () => {
    const qualifying = { standing: 'continuing', academic: 3.5, income: 'band-1', program: 'AB Psychology', prepaidPlan: false };
    expect(evaluateIllustration(qualifying).verdict).toBe('eligible');
    expect(evaluateIllustration({ ...qualifying, prepaidPlan: true }).verdict).toBe('ineligible');
    expect(evaluateIllustration(createIllustrationAnswers()).verdict).toBe('incomplete');
    expect(evaluateIllustration({ ...qualifying, income: 'band-3' }).verdict).toBe('ineligible');
    // The academic measure follows the standing, like the real checker.
    expect(evaluateIllustration({ ...qualifying, standing: 'incoming', academic: 90 }).verdict).toBe('eligible');
  });
});

describe('landing skip rule', () => {
  const clean = { search: '', hash: '', hasPendingOAuth: false, rememberedSignIn: false };

  it('shows the landing page to a first-time visitor', () => {
    expect(shouldSkipLanding({ entry: clean })).toBe(false);
    expect(shouldSkipLanding({ entry: { ...clean, hash: '#faq' } })).toBe(false);
  });

  it('skips it for an OAuth return, a reset or confirmation link, and their errors', () => {
    expect(shouldSkipLanding({ entry: { ...clean, search: '?code=abc' } })).toBe(true);
    expect(shouldSkipLanding({ entry: { ...clean, hash: '#access_token=x&type=recovery' } })).toBe(true);
    expect(shouldSkipLanding({ entry: { ...clean, search: '?token_hash=x&type=signup' } })).toBe(true);
    expect(shouldSkipLanding({ entry: { ...clean, hash: '#error=access_denied&sb=' } })).toBe(true);
    expect(shouldSkipLanding({ entry: { ...clean, hasPendingOAuth: true } })).toBe(true);
    expect(hasAuthRedirectPayload({ search: '?view=calendar' })).toBe(false);
  });

  it('skips it for a session notice and for a remembered email', () => {
    expect(shouldSkipLanding({ entry: clean, sessionNotice: 'You were signed out after a period of inactivity.' })).toBe(true);
    expect(shouldSkipLanding({ entry: clean, savedEmail: 'student@example.com' })).toBe(true);
    expect(shouldSkipLanding({ entry: clean, rememberMe: true })).toBe(true);
    expect(shouldSkipLanding({ entry: { ...clean, rememberedSignIn: true } })).toBe(true);
  });
});
