import { useEffect, useRef, useState } from 'react';
import { Menu, Moon, Sun, X } from 'lucide-react';
import { NAV_LINKS } from './content';

// A floating glass bar that tightens once the page scrolls. Below `lg` the
// section anchors and the two account actions move into a disclosure menu.
export default function LandingHeader({ logoSrc, theme, onToggleTheme, onSignIn, onGetStarted }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      setScrolled(window.scrollY > 24);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    // A press anywhere outside the menu and its toggle closes it. (The toggle
    // handles its own press, so it is excluded here to avoid close-then-reopen.)
    const onPointerDown = (event) => {
      if (menuRef.current?.contains(event.target) || menuButtonRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [menuOpen]);

  const themeLabel = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';

  return (
    <header className={`lp-header ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="lp-header-bar">
        <a href="#lp-top" className="lp-brand" aria-label="ScholarPath AdDU, back to top">
          <img src={logoSrc} alt="" width="36" height="36" className="lp-brand-logo" />
          <span className="lp-brand-name">ScholarPath <span className="lp-brand-accent">AdDU</span></span>
        </a>

        <nav className="lp-nav hidden lg:flex" aria-label="Page sections">
          {NAV_LINKS.map((link) => (
            <a key={link.id} href={`#${link.id}`} className="lp-nav-link">{link.label}</a>
          ))}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <button type="button" className="lp-icon-btn" onClick={onToggleTheme} aria-label={themeLabel} title={themeLabel}>
            {theme === 'light' ? <Moon size={19} aria-hidden="true" /> : <Sun size={19} aria-hidden="true" />}
          </button>
          <button type="button" className="lp-btn lp-btn--ghost hidden sm:inline-flex" onClick={onSignIn}>Sign in</button>
          <button type="button" className="lp-btn lp-btn--primary lp-btn--sm hidden lg:inline-flex" onClick={onGetStarted}>Create account</button>
          <button
            ref={menuButtonRef}
            type="button"
            className="lp-icon-btn lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="lp-mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Always rendered and animated open/closed with CSS; closed, it is
          `visibility: hidden` (out of the tab order and the accessibility tree). */}
      <div id="lp-mobile-menu" ref={menuRef} className={`lp-mobile-menu lg:hidden ${menuOpen ? 'is-open' : ''}`} aria-hidden={!menuOpen}>
        <nav aria-label="Page sections" className="grid gap-1">
          {NAV_LINKS.map((link, index) => (
            <a key={link.id} href={`#${link.id}`} className="lp-mobile-link" style={{ '--i': index }} onClick={() => setMenuOpen(false)}>{link.label}</a>
          ))}
        </nav>
        <div className="lp-mobile-actions mt-3 grid grid-cols-2 gap-2" style={{ '--i': NAV_LINKS.length }}>
          <button type="button" className="lp-btn lp-btn--ghost w-full" onClick={onSignIn}>Sign in</button>
          <button type="button" className="lp-btn lp-btn--primary w-full" onClick={onGetStarted}>Create account</button>
        </div>
      </div>
    </header>
  );
}
