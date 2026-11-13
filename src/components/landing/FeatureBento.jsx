import { useRef } from 'react';
import { Bell, CalendarDays, Check, FileText, FolderLock, Mail, MessageSquareText, MonitorSmartphone, Printer, Route, ShieldAlert, Sparkles } from 'lucide-react';
import { DOCUMENT_STATES } from './content';
import { MiniStageTrack } from './LandingHero';
import { useInView, usePointerField } from './motion';

const WORKSPACE_STEPS = ['Required documents', 'Application form', 'Financial situation', 'Statement', 'Review and submit'];

function Tile({ className = '', icon: Icon, title, body, children, pointerOn, delay = 0 }) {
  const ref = useRef(null);
  usePointerField(ref, pointerOn);
  return (
    <article ref={ref} className={`lp-tile ${className}`} data-reveal style={{ '--d': `${delay}ms` }}>
      <div className="lp-tile-art" aria-hidden="true">{children}</div>
      <div className="lp-tile-copy">
        <span className="lp-tile-icon"><Icon size={18} aria-hidden="true" /></span>
        <h3 className="lp-tile-title">{title}</h3>
        <p className="lp-tile-body">{body}</p>
      </div>
    </article>
  );
}

function ExclusionArt() {
  return (
    <div className="lp-art-exclusion">
      <div className="lp-art-rule"><Check size={14} /> Degree program is open</div>
      <div className="lp-art-rule"><Check size={14} /> Income within the ceiling</div>
      <div className="lp-art-rule"><Check size={14} /> Academic floor met</div>
      <div className="lp-art-override"><ShieldAlert size={15} /> Specific exclusion overrides</div>
    </div>
  );
}

function VaultArt() {
  return (
    <div className="lp-art-vault">
      <div className="lp-art-file">
        <FileText size={26} />
        <span className="lp-art-states">
          <span className="lp-pill lp-pill--wait">{DOCUMENT_STATES.Pending}</span>
          <span className="lp-pill lp-pill--ok">{DOCUMENT_STATES.Verified}</span>
        </span>
      </div>
      <div className="lp-art-links"><span /><span /><span /></div>
    </div>
  );
}

function CalendarArt() {
  // A fixed sample month: the deadline sits on the 24th, with the 7-, 3-, and
  // 1-day reminders before it.
  const reminders = { 17: '7', 21: '3', 23: '1' };
  return (
    <div className="lp-art-cal">
      {Array.from({ length: 28 }, (_, index) => {
        const day = index + 1;
        const isDeadline = day === 24;
        return (
          <span key={day} className={`${isDeadline ? 'is-deadline' : ''} ${reminders[day] ? 'is-reminder' : ''}`} style={{ '--i': Object.keys(reminders).indexOf(String(day)) }}>
            {day}
          </span>
        );
      })}
    </div>
  );
}

function ChannelArt() {
  return (
    <div className="lp-art-channels">
      <span style={{ '--i': 0 }}><MonitorSmartphone size={14} /> In-app</span>
      <span style={{ '--i': 1 }}><Mail size={14} /> Email</span>
      <span style={{ '--i': 2 }}><MessageSquareText size={14} /> SMS</span>
    </div>
  );
}

function WorkspaceArt() {
  return (
    <div className="lp-art-workspace">
      <ol>
        {WORKSPACE_STEPS.map((step, index) => <li key={step} style={{ '--i': index }}><span>{index + 1}</span>{step}</li>)}
      </ol>
      <div className="lp-art-printer">
        <div className="lp-art-sheet"><strong>FORM 230-SCH</strong><i /><i /><i /><i /></div>
        <div className="lp-art-printer-body"><Printer size={18} /></div>
      </div>
    </div>
  );
}

export default function FeatureBento({ pointerOn, motionOn }) {
  const gridRef = useRef(null);
  const live = useInView(gridRef, { rootMargin: '0px 0px -10% 0px' });

  return (
    <section id="features" className="lp-section" aria-labelledby="lp-features-title">
      <div className="lp-shell">
        <header className="lp-section-head" data-reveal>
          <p className="lp-eyebrow">Inside the workspace</p>
          <h2 id="lp-features-title" className="lp-h2">Built for the whole <span className="lp-serif">application, not one form.</span></h2>
        </header>

        <div ref={gridRef} className={`lp-bento ${live && motionOn ? 'is-live' : ''}`}>
          <Tile className="lp-tile--eligibility" icon={Sparkles} title="Smart Eligibility Checker" pointerOn={pointerOn}
            body="Checks your QPI or senior high school average, household income and degree program against each grant. The Exclusion Flag Hierarchy lets a specific exclusion override every broad match.">
            <ExclusionArt />
          </Tile>
          <Tile className="lp-tile--vault" icon={FolderLock} title="Document Vault" pointerOn={pointerOn} delay={80}
            body="Upload a file once and attach it to every application. Each file shows whether it is Pending, Verified, or Reverted for resubmission.">
            <VaultArt />
          </Tile>
          <Tile className="lp-tile--tracking" icon={Route} title="Application tracking" pointerOn={pointerOn} delay={120}
            body="Every stage is dated in your application’s history, so you always know where it stands.">
            <MiniStageTrack current={5} compact />
          </Tile>
          <Tile className="lp-tile--calendar" icon={CalendarDays} title="Deadline calendar" pointerOn={pointerOn} delay={160}
            body="Scholarship deadlines and your own reminders, with alerts 7, 3, and 1 day before.">
            <CalendarArt />
          </Tile>
          <Tile className="lp-tile--notify" icon={Bell} title="Notification center" pointerOn={pointerOn} delay={200}
            body="Status changes in the app, and by email or SMS when you switch those on.">
            <ChannelArt />
          </Tile>
          <Tile className="lp-tile--workspace" icon={Printer} title="Application workspace" pointerOn={pointerOn} delay={240}
            body="Five clear steps from required documents to submit, then print your application laid out like FORM 230-SCH.">
            <WorkspaceArt />
          </Tile>
        </div>
      </div>
    </section>
  );
}
