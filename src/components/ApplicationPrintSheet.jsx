import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import { Button } from './ui';
import { ApplicantPhotoThumb } from './ApplicationParts';
import { getProfileSnapshotSections } from '../lib/applicationRequirements';
import { AFFIDAVIT_CLAUSES, DATA_PRIVACY_NOTICE, ESSAY_INSTRUCTION, ESSAY_TOPIC } from '../lib/applicationForm';
import { fmtDate } from '../lib/formatters';
import { summarizeInterview } from '../lib/interview';

// The order follows FORM 230-SCH: applicant, education, family, finances, other.
const SECTION_ORDER = ['application', 'personal', 'education', 'eligibility', 'background', 'family', 'finances', 'situation', 'aid'];

const REQUIREMENT_STATE_TEXT = {
  missing: 'Not attached',
  rejected: 'Reverted for resubmission',
  outdated: 'Outdated',
  attached: 'Attached (pending review)',
  verified: 'Verified',
};

function PrintRows({ rows }) {
  return (
    <table className="w-full border-collapse text-[10.5pt]">
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="align-top">
            <th scope="row" className="w-[34%] border border-neutral-400 bg-neutral-100 px-2 py-1 text-left font-semibold">{row.label}</th>
            <td className="border border-neutral-400 px-2 py-1 [overflow-wrap:anywhere]">
              {row.value || '—'}{row.verification ? ` [${row.verification}]` : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SignatureLine({ label }) {
  return (
    <div className="grid gap-1">
      <div className="h-10 border-b border-black" />
      <span className="text-[9.5pt]">{label}</span>
    </div>
  );
}

// The printable application, laid out in the order of FORM 230-SCH. It carries the
// two pages that cannot be captured in the system: the Punong Barangay's
// certification of the residence photos and the signed affidavit of agreement.
// The student prints them, gets them signed, and uploads the signed pages as the
// matching required documents. `financialSections` is empty for a viewer who may
// not read the financial details (the Department Chair).
export function ApplicationPrintSheet({
  application,
  snapshot,
  financialSections = [],
  statement = '',
  requirements = [],
  applicantPhoto = null,
  audience = 'student',
}) {
  const { sections } = getProfileSnapshotSections(snapshot);
  const rowsBySection = new Map(sections.map((section) => [section.key, section]));
  financialSections.forEach((section) => rowsBySection.set(section.key, section));
  const ordered = SECTION_ORDER.map((key) => rowsBySection.get(key)).filter(Boolean);
  const residingAddress = snapshot?.address?.residingAddress || snapshot?.address?.completeAddress || '';

  return (
    <div className="print-sheet-root" role="document" aria-label="Application for Financial Aid printout">
      <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
        <div className="grid gap-1">
          <strong className="text-[15pt]">Ateneo de Davao University</strong>
          <span className="text-[12pt] font-semibold">Application for Financial Aid (FORM 230-SCH order)</span>
          <span className="text-[10pt]">Printed from ScholarPath AdDU · {fmtDate(new Date().toISOString())}</span>
        </div>
        <ApplicantPhotoThumb doc={applicantPhoto} />
      </header>

      <section className="mt-3 grid gap-1 text-[10.5pt]">
        <PrintRows rows={[
          { label: 'Applying for', value: application?.scholarshipTitle },
          { label: 'Reference', value: application?.id },
          { label: 'Status', value: application?.status },
          { label: 'Submitted', value: application?.submittedAt ? fmtDate(application.submittedAt) : 'Not yet submitted' },
        ]} />
      </section>

      {ordered.map((section) => (
        <section key={section.key} className="mt-4">
          <h2 className="m-0 mb-1 text-[11.5pt] font-bold uppercase tracking-wide">{section.title}</h2>
          <PrintRows rows={section.rows} />
        </section>
      ))}
      {audience === 'chair' ? (
        <p className="mt-4 text-[10pt] italic">Household finances and the financial situation are shared with the Admissions Office only.</p>
      ) : null}

      <section className="mt-4">
        <h2 className="m-0 mb-1 text-[11.5pt] font-bold uppercase tracking-wide">Scholarship essay</h2>
        <p className="m-0 mb-1 text-[10pt] italic">{ESSAY_TOPIC}</p>
        <p className="m-0 mb-1 text-[9.5pt]">{ESSAY_INSTRUCTION}</p>
        <div className="min-h-24 whitespace-pre-line border border-neutral-400 px-2 py-1 text-[10.5pt]">{statement || 'No statement recorded.'}</div>
      </section>

      {requirements.length ? (
        <section className="mt-4">
          <h2 className="m-0 mb-1 text-[11.5pt] font-bold uppercase tracking-wide">Required documents</h2>
          <PrintRows rows={requirements.map((item) => ({
            label: item.label,
            value: [REQUIREMENT_STATE_TEXT[item.state] || item.state, ...(item.attached || []).map((doc) => doc.title)].filter(Boolean).join(' · '),
          }))} />
        </section>
      ) : null}

      {application?.interview ? (
        <section className="mt-4 text-[10.5pt]">
          <h2 className="m-0 mb-1 text-[11.5pt] font-bold uppercase tracking-wide">Interview</h2>
          <p className="m-0">{summarizeInterview(application.interview)}</p>
        </section>
      ) : null}

      <section className="print-page-break pt-2">
        <h2 className="m-0 text-[13pt] font-bold uppercase tracking-wide">Certification of residence</h2>
        <p className="mt-2 text-[10.5pt]">
          Attach the photos of the residence below (front view of the whole house and the kitchen, or the building and the room) with the complete address. This page must be certified and signed by the Punong Barangay, then uploaded to ScholarPath AdDU as the Barangay certification of residence.
        </p>
        <PrintRows rows={[
          { label: 'Applicant', value: snapshot?.fullName },
          { label: 'Complete address', value: residingAddress },
        ]} />
        <div className="mt-3 grid min-h-64 place-items-center border border-dashed border-neutral-500 text-[10pt] text-neutral-600">Paste or print the residence photos here</div>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <SignatureLine label="Punong Barangay (name and signature)" />
          <SignatureLine label="Barangay and date" />
        </div>
      </section>

      <section className="print-page-break pt-2">
        <h2 className="m-0 text-[13pt] font-bold uppercase tracking-wide">Affidavit of agreement</h2>
        <ol className="mt-2 grid gap-2 pl-5 text-[10.5pt]">
          {AFFIDAVIT_CLAUSES.map((clause) => <li key={clause}>{clause}</li>)}
        </ol>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          <SignatureLine label="Applicant (signature over printed name)" />
          <SignatureLine label="Father (signature over printed name)" />
          <SignatureLine label="Mother (signature over printed name)" />
        </div>
        <h3 className="mb-1 mt-8 text-[11pt] font-bold">Data privacy notice</h3>
        <p className="m-0 text-[10pt]">{DATA_PRIVACY_NOTICE}</p>
      </section>
    </div>
  );
}

// Prints the application through the browser (window.print) so the same page can
// be saved as a PDF. The sheet is mounted only while printing; the matching
// `@media print` rules in styles.css hide everything else.
export default function ApplicationPrintButton({ label = 'Print application form', variant = 'secondary', className = '', sheet }) {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return undefined;
    const finish = () => setPrinting(false);
    window.addEventListener('afterprint', finish);
    // Let the sheet (and the signed photo URL) render before the dialog opens.
    const timer = window.setTimeout(() => window.print(), 400);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', finish);
    };
  }, [printing]);

  return (
    <>
      <Button type="button" variant={variant} className={className} onClick={() => setPrinting(true)} disabled={printing}>
        <Printer aria-hidden="true" className="mr-2 inline h-4 w-4" />
        {printing ? 'Preparing…' : label}
      </Button>
      {printing && typeof document !== 'undefined' ? createPortal(<ApplicationPrintSheet {...sheet} />, document.body) : null}
    </>
  );
}
