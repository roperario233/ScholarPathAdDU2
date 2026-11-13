import { useEffect, useRef, useState } from 'react';
import { JOURNEY_STEPS } from './content';
import JourneyVisual from './JourneyVisuals';
import { useInView, useScrollProgress } from './motion';

// One step of the story. Below `lg` its illustration sits inline under the text
// and plays when the step scrolls into view; from `lg` the illustration lives in
// the sticky frame instead.
function Step({ step, index, active, onEnter, motionOn }) {
  const ref = useRef(null);
  const visualRef = useRef(null);
  const visualInView = useInView(visualRef, { threshold: 0.35 });

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    // A thin band across the middle of the viewport decides the active step, so
    // exactly one step is current while scrolling in either direction.
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) onEnter(index);
    }, { rootMargin: '-48% 0px -48% 0px', threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [index, onEnter]);

  return (
    <li ref={ref} className={`lp-step ${active ? 'is-current' : ''}`} data-reveal>
      <span className="lp-step-marker" aria-hidden="true">{index + 1}</span>
      <div className="lp-step-copy">
        <p className="lp-step-kicker">{step.kicker}</p>
        <h3 className="lp-step-title">{step.title}</h3>
        <p className="lp-step-body">{step.body}</p>
      </div>
      <div ref={visualRef} className="lp-step-inline lg:hidden">
        <JourneyVisual id={step.id} active={!motionOn || visualInView} />
      </div>
    </li>
  );
}

export default function JourneyStory({ motionOn }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef(null);
  // The rail fill follows scroll position; with reduced motion it simply stays
  // full and the markers carry the state.
  useScrollProgress(listRef, { enabled: motionOn, property: '--rail' });

  return (
    <section id="journey" className="lp-section lp-journey" aria-labelledby="lp-journey-title">
      <div className="lp-shell">
        <header className="lp-section-head" data-reveal>
          <p className="lp-eyebrow">The path of one application</p>
          <h2 id="lp-journey-title" className="lp-h2">From first check <span className="lp-serif">to recorded result.</span></h2>
          <p className="lp-lede">Five moments, one workspace. Scroll the path the way your application travels it.</p>
        </header>

        <div className="lp-journey-grid">
          <div ref={listRef} className="lp-steps-wrap" style={motionOn ? undefined : { '--rail': 1 }}>
            <span className="lp-rail" aria-hidden="true"><span className="lp-rail-fill" /></span>
            <ol className="lp-steps">
            {JOURNEY_STEPS.map((step, index) => (
              <Step
                key={step.id}
                step={step}
                index={index}
                active={index === activeIndex}
                onEnter={setActiveIndex}
                motionOn={motionOn}
              />
            ))}
            </ol>
          </div>

          <div className="lp-journey-sticky hidden lg:block">
            <div className="lp-journey-frame">
              <div className="lp-journey-glow" aria-hidden="true" />
              {JOURNEY_STEPS.map((step, index) => (
                <div key={step.id} className={`lp-journey-slide ${index === activeIndex ? 'is-shown' : ''}`} data-step={index}>
                  <JourneyVisual id={step.id} active={!motionOn || index === activeIndex} />
                </div>
              ))}
              <ol className="lp-journey-dots" aria-hidden="true">
                {JOURNEY_STEPS.map((step, index) => (
                  <li key={step.id} className={index <= activeIndex ? 'is-on' : ''} />
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
