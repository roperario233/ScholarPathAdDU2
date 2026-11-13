import { Bell, Check, CheckCircle2, CircleHelp, FileText, Mail, MessageSquareText, MonitorSmartphone } from 'lucide-react';
import { DOCUMENT_STATES, FORM_PARTS, STAGE_LABELS } from './content';

// One illustration per journey step. Each renders its finished state by default
// (the reduced-motion and no-JS picture); with motion on, the CSS starts it from
// its opening state and plays it forward while `active`. All are decorative: the
// step text beside them carries the meaning.

function Frame({ title, meta, children, className = '' }) {
  return (
    <div className={`lp-glass lp-vframe ${className}`}>
      <div className="lp-mock-head">
        <span className="lp-mock-kicker">{title}</span>
        {meta && <span className="lp-mock-meta">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

function CheckVisual() {
  const rows = ['Filipino citizenship', 'Degree program is a WSP program', 'No exclusion flag declared'];
  return (
    <Frame title="Working Scholar Program (WSP)" meta="Smart Eligibility Checker" className="lp-v-check">
      <div className="lp-verdict-swap">
        <div className="lp-verdict lp-verdict--wait lp-verdict-from"><CircleHelp size={18} aria-hidden="true" /><strong>Answers needed</strong></div>
        <div className="lp-verdict lp-verdict--ok lp-verdict-to"><CheckCircle2 size={18} aria-hidden="true" /><strong>You qualify</strong></div>
      </div>
      <ul className="lp-vrows">
        {rows.map((row, index) => (
          <li key={row} style={{ '--i': index }}>
            <span className="lp-vtick"><Check size={13} aria-hidden="true" /></span>
            <span>{row}</span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

function FormVisual() {
  return (
    <Frame title="Application Form" meta="FORM 230-SCH · 6 parts" className="lp-v-form">
      <ol className="lp-vparts">
        {FORM_PARTS.map((part, index) => (
          <li key={part} style={{ '--i': index }}>
            <span className="lp-vpart-num"><span className="lp-vpart-n">{index + 1}</span><Check size={13} className="lp-vpart-check" aria-hidden="true" /></span>
            <span>{part}</span>
          </li>
        ))}
      </ol>
      <div className="lp-vprogress"><span /></div>
      <p className="lp-vready"><CheckCircle2 size={16} aria-hidden="true" /> Ready to apply</p>
    </Frame>
  );
}

function VaultVisual() {
  const targets = ['Grant-in-Aid (GIA)', 'Working Scholar Program (WSP)', 'Jubilee Scholarship (JSF)'];
  return (
    <Frame title="Document Vault" meta="One file, three applications" className="lp-v-vault">
      <div className="lp-fan">
        <div className="lp-fan-file">
          <FileText size={22} aria-hidden="true" />
          <strong>PSA birth certificate</strong>
          <span className="lp-pill lp-pill--ok">{DOCUMENT_STATES.Verified}</span>
        </div>
        <svg className="lp-fan-lines" viewBox="0 0 100 120" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path pathLength="1" d="M0 60 C 45 60, 55 14, 100 14" style={{ '--i': 0 }} />
          <path pathLength="1" d="M0 60 C 45 60, 55 60, 100 60" style={{ '--i': 1 }} />
          <path pathLength="1" d="M0 60 C 45 60, 55 106, 100 106" style={{ '--i': 2 }} />
        </svg>
        <ul className="lp-fan-apps">
          {targets.map((target, index) => (
            <li key={target} style={{ '--i': index }}>
              <span className="min-w-0 truncate">{target}</span>
              <span className="lp-fan-attached"><Check size={12} aria-hidden="true" /> Attached</span>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

function TrackVisual() {
  return (
    <Frame title="Grant-in-Aid (GIA) · Application" meta={`${STAGE_LABELS.length} stages`} className="lp-v-track">
      <ol className="lp-vstages">
        {STAGE_LABELS.map((label, index) => (
          <li key={label} style={{ '--i': index }}>
            <span className="lp-vstage-dot" />
            <span className="lp-vstage-label">{label}</span>
          </li>
        ))}
      </ol>
      <p className="lp-vready lp-vready--end"><CheckCircle2 size={16} aria-hidden="true" /> Released and shown to you as Accepted</p>
    </Frame>
  );
}

function NotifyVisual() {
  const channels = [
    { label: 'In-app', icon: MonitorSmartphone },
    { label: 'Email', icon: Mail },
    { label: 'SMS', icon: MessageSquareText },
  ];
  return (
    <Frame title="Notification center" meta="Your channels" className="lp-v-notify">
      <div className="lp-vchannels">
        {channels.map(({ label, icon: Icon }, index) => (
          <span key={label} className="lp-vchannel" style={{ '--i': index }}><Icon size={15} aria-hidden="true" />{label}</span>
        ))}
      </div>
      <ul className="lp-vnotes">
        <li style={{ '--i': 0 }}>
          <span className="lp-note-icon"><Bell size={14} aria-hidden="true" /></span>
          <span className="min-w-0"><strong>Your application is now {STAGE_LABELS[3]}</strong><small>Grant-in-Aid (GIA)</small></span>
        </li>
        <li style={{ '--i': 1 }}>
          <span className="lp-note-icon lp-note-icon--spark"><Bell size={14} aria-hidden="true" /></span>
          <span className="min-w-0"><strong>Deadline in 3 days</strong><small>Reminders 7, 3 and 1 day before</small></span>
        </li>
      </ul>
    </Frame>
  );
}

const VISUALS = { check: CheckVisual, form: FormVisual, vault: VaultVisual, track: TrackVisual, notify: NotifyVisual };

export default function JourneyVisual({ id, active }) {
  const Visual = VISUALS[id];
  return (
    <div className={`lp-visual ${active ? 'is-active' : ''}`} aria-hidden="true">
      <Visual />
    </div>
  );
}
