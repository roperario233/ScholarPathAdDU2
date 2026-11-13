import { ArrowRight } from 'lucide-react';
import { LEGAL_DOCUMENT_KEYS, LEGAL_DOCUMENT_SHORT_LABELS, getLegalDocumentTitle } from '../../lib/legalDocs';
import { CampusBackdrop } from './CampusBackdrop';
import { useMagnetic } from './motion';

export default function FinalCta({ pointerOn, onGetStarted, onSignIn }) {
  const primaryRef = useMagnetic(pointerOn);

  return (
      <section className="lp-final" aria-labelledby="lp-final-title">
        <div className="lp-final-aurora" aria-hidden="true">
          <CampusBackdrop className="lp-campus--final" />
          <span className="lp-blob lp-blob--a" />
          <span className="lp-blob lp-blob--c" />
          <span className="lp-grain" />
        </div>
        <svg className="lp-final-path" viewBox="0 0 1200 220" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path pathLength="1" d="M -20 180 C 240 60, 420 200, 640 110 S 1020 20, 1220 70" />
        </svg>
        <div className="lp-shell lp-final-inner" data-reveal>
          <p className="lp-eyebrow">Your first step</p>
          <h2 id="lp-final-title" className="lp-final-title">Start your path <span className="lp-serif">today.</span></h2>
          <p className="lp-lede">Create your account, answer your Application Form once, and see which AdDU grants you qualify for.</p>
          <div className="lp-hero-actions justify-center">
            <button ref={primaryRef} type="button" className="lp-btn lp-btn--primary lp-btn--lg lp-magnetic" onClick={onGetStarted}>
              <span>Create account</span>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
            <button type="button" className="lp-btn lp-btn--glass lp-btn--lg" onClick={onSignIn}>I already have an account</button>
          </div>
        </div>
      </section>
  );
}

// The prototype note and the three policy documents, which open over the page in
// the existing LegalDocumentDialog.
export function LandingFooter({ logoSrc, onOpenLegalDocument }) {
  return (
      <footer className="lp-footer">
        <div className="lp-shell lp-footer-inner">
          <div className="lp-footer-brand">
            <img src={logoSrc} alt="" width="40" height="40" className="lp-brand-logo" />
            <div>
              <strong>ScholarPath AdDU</strong>
              <p>ScholarPath AdDU is a research prototype of Ateneo de Davao University. Your information is handled under the Data Privacy Act of 2012.</p>
            </div>
          </div>
          <nav aria-label="Privacy and terms" className="lp-footer-links">
            {LEGAL_DOCUMENT_KEYS.map((key) => (
              <button key={key} type="button" className="lp-footer-link" aria-label={getLegalDocumentTitle(key)} onClick={() => onOpenLegalDocument?.(key)}>
                {/* Short names on a phone so all three fit one line; full names from 768px. */}
                <span className="lp-footer-link-short" aria-hidden="true">{LEGAL_DOCUMENT_SHORT_LABELS[key] || getLegalDocumentTitle(key)}</span>
                <span className="lp-footer-link-full" aria-hidden="true">{getLegalDocumentTitle(key)}</span>
              </button>
            ))}
          </nav>
        </div>
      </footer>
  );
}
