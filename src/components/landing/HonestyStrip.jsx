import { Check, Minus } from 'lucide-react';
import { HONESTY_POINTS } from './content';

// What ScholarPath is, and what it deliberately is not. Stated as plainly and
// as confidently as the features.
export default function HonestyStrip() {
  return (
    <section id="honest" className="lp-section lp-honest" aria-labelledby="lp-honest-title">
      <div className="lp-shell">
        <div className="lp-honest-panel" data-reveal>
          <header className="lp-honest-head">
            <p className="lp-eyebrow">Plainly stated</p>
            <h2 id="lp-honest-title" className="lp-h2">Clear about what it does. <span className="lp-serif">Clearer about what it doesn’t.</span></h2>
          </header>
          <div className="lp-honest-cols">
            <div>
              <h3 className="lp-honest-label lp-honest-label--is">ScholarPath is</h3>
              <ul className="lp-honest-list">
                {HONESTY_POINTS.is.map((point) => (
                  <li key={point.title}>
                    <span className="lp-honest-mark lp-honest-mark--is"><Check size={16} aria-hidden="true" /></span>
                    <div><strong>{point.title}</strong><p>{point.body}</p></div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="lp-honest-label lp-honest-label--not">ScholarPath is not</h3>
              <ul className="lp-honest-list">
                {HONESTY_POINTS.isNot.map((point) => (
                  <li key={point.title}>
                    <span className="lp-honest-mark lp-honest-mark--not"><Minus size={16} aria-hidden="true" /></span>
                    <div><strong>{point.title}</strong><p>{point.body}</p></div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
