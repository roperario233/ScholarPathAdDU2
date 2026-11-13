import { useState } from 'react';
import { Plus } from 'lucide-react';
import { FAQS } from './content';

// A disclosure list: each question is a real button with aria-expanded and
// aria-controls, the answer a labelled region. Opening and closing animate a CSS
// grid row (0fr to 1fr) and fade the text in; a closed answer stays in the markup
// but is `visibility: hidden` (so it leaves the tab order and the accessibility
// tree) and `aria-hidden`. Under reduced motion it simply swaps, with the same
// final state.
export default function LandingFaq({ initialOpen = null }) {
  const [openId, setOpenId] = useState(initialOpen);

  return (
    <section id="faq" className="lp-section" aria-labelledby="lp-faq-title">
      <div className="lp-shell lp-faq-grid">
        <header className="lp-section-head lp-faq-head" data-reveal>
          <p className="lp-eyebrow">Questions</p>
          <h2 id="lp-faq-title" className="lp-h2">Asked before <span className="lp-serif">you sign up.</span></h2>
        </header>

        <div className="lp-faq" data-reveal>
          {FAQS.map((faq) => {
            const open = openId === faq.id;
            return (
              <div key={faq.id} className={`lp-faq-item ${open ? 'is-open' : ''}`}>
                <h3 className="m-0">
                  <button
                    type="button"
                    id={`lp-faq-q-${faq.id}`}
                    className="lp-faq-q"
                    aria-expanded={open}
                    aria-controls={`lp-faq-a-${faq.id}`}
                    onClick={() => setOpenId(open ? null : faq.id)}
                  >
                    <span>{faq.question}</span>
                    <Plus size={20} aria-hidden="true" className="lp-faq-icon" />
                  </button>
                </h3>
                <div
                  id={`lp-faq-a-${faq.id}`}
                  role="region"
                  aria-labelledby={`lp-faq-q-${faq.id}`}
                  className="lp-faq-a"
                  aria-hidden={!open}
                >
                  <div className="lp-faq-a-inner"><p>{faq.answer}</p></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
