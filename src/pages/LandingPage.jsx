/*
 * ScholarPath AdDU — public landing page
 * ─────────────────────────────────────────────────────────────────────────────
 * CONCEPT  "The path of one application." The page is the route a single
 *          application travels: a luminous line is drawn through the hero's
 *          product cards, carries a bright marker along it, becomes the progress
 *          rail of the scroll story (check → form → vault → track → notify), and
 *          closes as a sweep across the final call to action. Every flourish
 *          either draws that path or shows a real piece of the product.
 *
 * TYPE     One family, Inter, throughout (no separate display face). Display
 *                   800, clamp(2.6rem → 5.4rem), tracking −0.04em, the accent
 *                   phrase in blue (an all-blue gradient per word, never one that
 *                   ends in white).
 *          H2       Inter 800, clamp(2rem → 3.6rem), tracking −0.03em, the second
 *                   half of a heading in the accent blue.
 *          H3       Inter 700, 1.25–1.5rem.
 *          Eyebrow  Inter 700, 0.75rem, uppercase, tracking 0.18em.
 *          Body     Inter 400, 1.0625rem / 1.65; small 0.875rem.
 *
 * COLOUR   Dark   ink #030a1c · navy #071a3d · Ateneo #0033A0 · glow #4f8cff ·
 *                 cyan #38bdf8 · spark #9ed8ff (the highlight: path, marker,
 *                 current stage) · indigo #818cf8 (Jubilee) · text #eef4ff ·
 *                 muted #a9bbd8. Glass rgba(12,30,66,.62) on a 1px #8cb4ff2e rim.
 *          Light  paper #f5f8ff · ink text #0b2150 · muted #45608a · glow
 *                 #2f6bff · spark #0a4bd1 (text #0033a0). Glass white .74 with soft
 *                 blue shadows instead of glows.
 *          Tokens live on `.lp` in src/landing.css (--lp-*), redefined under
 *          `.theme-light .lp`; shared app tokens (bg-app-card, border-app-border,
 *          text-app-text …) are used wherever the app's own surfaces appear.
 *
 * MOTION   One easing, "expo-out" cubic-bezier(.16,1,.3,1). Reveals 800ms,
 *          staggered 60–110ms; ambient loops 18–40s; micro-loops 4–7s.
 *          transform/opacity only. Reveals use one IntersectionObserver; looping
 *          art runs only while its section is on screen and the tab is visible;
 *          pointer parallax, tilt, spotlight and magnetic buttons run only on
 *          (hover: hover) and (pointer: fine). prefers-reduced-motion removes all
 *          of it and renders every illustration in its finished state; no
 *          content is ever hidden behind an animation, and the story never
 *          takes over the scrollbar.
 */
import { useRef } from 'react';
import logoImage from '../../pictures/logo.png';
import LandingHeader from '../components/landing/LandingHeader';
import LandingHero from '../components/landing/LandingHero';
import GrantCards from '../components/landing/GrantCards';
import JourneyStory from '../components/landing/JourneyStory';
import EligibilityIllustration from '../components/landing/EligibilityIllustration';
import FeatureBento from '../components/landing/FeatureBento';
import AudienceSection from '../components/landing/AudienceSection';
import HonestyStrip from '../components/landing/HonestyStrip';
import LandingFaq from '../components/landing/LandingFaq';
import FinalCta, { LandingFooter } from '../components/landing/FinalCta';
import { useFinePointer, usePrefersReducedMotion, useRevealObserver } from '../components/landing/motion';
import '../landing.css';

export default function LandingPage({ theme, onToggleTheme, onGetStarted, onSignIn, onOpenLegalDocument }) {
  const rootRef = useRef(null);
  const reducedMotion = usePrefersReducedMotion();
  const finePointer = useFinePointer();
  // Motion is opt-in: without an IntersectionObserver (or with reduced motion)
  // the page renders fully, statically, and nothing waits on a reveal.
  const motionOn = !reducedMotion && typeof IntersectionObserver !== 'undefined';
  const pointerOn = motionOn && finePointer;
  useRevealObserver(rootRef, motionOn);

  return (
    <div ref={rootRef} className="lp" data-motion={motionOn ? 'on' : 'off'}>
      <a href="#lp-main" className="lp-skip">Skip to main content</a>

      <LandingHeader
        logoSrc={logoImage}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onSignIn={onSignIn}
        onGetStarted={onGetStarted}
      />

      <main id="lp-main" tabIndex={-1} className="lp-main">
        <LandingHero motionOn={motionOn} finePointer={finePointer} onGetStarted={onGetStarted} onSignIn={onSignIn} />
        <GrantCards pointerOn={pointerOn} />
        <JourneyStory motionOn={motionOn} />
        <EligibilityIllustration />
        <FeatureBento pointerOn={pointerOn} motionOn={motionOn} />
        <AudienceSection />
        <HonestyStrip />
        <LandingFaq />
        <FinalCta pointerOn={pointerOn} onGetStarted={onGetStarted} onSignIn={onSignIn} />
      </main>

      <LandingFooter logoSrc={logoImage} onOpenLegalDocument={onOpenLegalDocument} />
    </div>
  );
}
