import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import { Button } from './ui';
import { ApplicantPhotoThumb, SignedVaultImage } from './ApplicationParts';
import { getProfileSnapshotSections } from '../lib/applicationRequirements';
import { fmtDate } from '../lib/formatters';
import { summarizeInterview } from '../lib/interview';

// The order follows FORM 230-SCH: applicant, education, family, finances, other.
const SECTION_ORDER = ['application', 'personal', 'education', 'eligibility', 'background', 'family', 'finances', 'situation', 'aid'];

function PrintRows({ rows }) {
  return (
    <table className="w-full border-collapse overflow-hidden rounded-[3px] text-[10pt]">
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="align-top">
            <th scope="row" className="w-[34%] border border-slate-300 bg-slate-100 px-2.5 py-1.5 text-left text-[9.5pt] font-semibold text-slate-700">{row.label}</th>
            <td className="border border-slate-300 px-2.5 py-1.5 text-slate-900 [overflow-wrap:anywhere]">
              {row.value || <span className="text-slate-400">—</span>}
              {row.verification ? <span className="ml-1.5 whitespace-nowrap rounded-sm bg-slate-100 px-1 py-px text-[8pt] font-semibold uppercase tracking-wide text-slate-600">{row.verification}</span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SectionHeading({ children, large = false }) {
  return (
    <h2 className={`m-0 mb-2 flex items-center gap-2 border-b border-[#0033A0]/30 pb-1 font-bold uppercase tracking-[0.08em] text-[#0033A0] ${large ? 'text-[13pt]' : 'text-[10.5pt]'}`}>
      <span aria-hidden="true" className="inline-block h-[1em] w-1 rounded-sm bg-[#0033A0]" />
      {children}
    </h2>
  );
}

function SummaryCell({ label, value }) {
  return (
    <div className="grid content-start gap-0.5 px-3 py-2">
      <span className="text-[8pt] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</span>
      <strong className="text-[10.5pt] font-semibold text-slate-900 [overflow-wrap:anywhere]">{value || '—'}</strong>
    </div>
  );
}

// One residence photo from the Document Vault. `data-loading` stays true until
// the signed URL has produced a picture (or failed), so the print button does
// not open the dialog on an empty frame.
function ResidencePhoto({ doc, index }) {
  const [settled, setSettled] = useState(false);
  return (
    <figure className="m-0 grid gap-1.5 break-inside-avoid" data-print-photo data-loading={settled ? 'false' : 'true'}>
      <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-[3px] border border-slate-300 bg-slate-50">
        <SignedVaultImage doc={doc} alt={`Photo of the residence ${index + 1}`} className="h-full w-full object-cover" onSettled={() => setSettled(true)} />
      </div>
      <figcaption className="text-[9pt] font-semibold uppercase tracking-[0.08em] text-slate-500">Photo {index + 1}</figcaption>
    </figure>
  );
}

// The printable application, laid out in the order of FORM 230-SCH, ending with
// a page that shows the residence: the complete address and the residence photos
// the application attaches. `financialSections` is empty for a viewer who may
// not read the financial details (the Department Chair).
export function ApplicationPrintSheet({
  application,
  snapshot,
  financialSections = [],
  statement = '',
  applicantPhoto = null,
  residencePhotos = [],
  audience = 'student',
}) {
  const { sections } = getProfileSnapshotSections(snapshot);
  const rowsBySection = new Map(sections.map((section) => [section.key, section]));
  financialSections.forEach((section) => rowsBySection.set(section.key, section));
  const ordered = SECTION_ORDER.map((key) => rowsBySection.get(key)).filter(Boolean);
  const residingAddress = snapshot?.address?.residingAddress || snapshot?.address?.completeAddress || '';

  return (
    <div className="print-sheet-root" role="document" aria-label="Application for Financial Aid printout">
      <header className="flex items-start justify-between gap-4 border-b-[3px] border-[#0033A0] pb-3">
        <div className="grid gap-1">
          <span className="text-[9pt] font-semibold uppercase tracking-[0.18em] text-slate-500">Ateneo de Davao University</span>
          <strong className="text-[17pt] font-bold leading-tight text-[#0033A0]">Application for Financial Aid</strong>
          <span className="text-[10pt] text-slate-600">FORM 230-SCH order · Printed from ScholarPath AdDU on {fmtDate(new Date().toISOString())}</span>
        </div>
        <ApplicantPhotoThumb doc={applicantPhoto} className="!h-28 !w-28 !rounded-[4px] !border-slate-400 !bg-white" />
      </header>

      <section className="mt-3 grid grid-cols-4 divide-x divide-slate-300 rounded-[3px] border border-slate-300 bg-slate-50">
        <SummaryCell label="Applying for" value={application?.scholarshipTitle} />
        <SummaryCell label="Reference" value={application?.id} />
        <SummaryCell label="Status" value={application?.status} />
        <SummaryCell label="Submitted" value={application?.submittedAt ? fmtDate(application.submittedAt) : 'Not yet submitted'} />
      </section>

      {ordered.map((section) => (
        <section key={section.key} className="mt-5">
          <SectionHeading>{section.title}</SectionHeading>
          <PrintRows rows={section.rows} />
        </section>
      ))}
      {audience === 'chair' ? (
        <p className="mt-5 text-[9.5pt] italic text-slate-600">Household finances and the financial situation are shared with the Admissions Office only.</p>
      ) : null}

      <section className="mt-5">
        <SectionHeading>Statement/essay</SectionHeading>
        <div className="min-h-24 whitespace-pre-line rounded-[3px] border border-slate-300 px-3 py-2 text-[10.5pt] leading-relaxed text-slate-900">{statement || 'No statement recorded.'}</div>
      </section>

      {application?.interview ? (
        <section className="mt-5 text-[10.5pt]">
          <SectionHeading>Interview</SectionHeading>
          <p className="m-0 text-slate-900">{summarizeInterview(application.interview)}</p>
        </section>
      ) : null}

      <section className="print-page-break pt-2">
        <SectionHeading large>Residence</SectionHeading>
        <div>
          <PrintRows rows={[
            { label: 'Applicant', value: snapshot?.fullName },
            { label: 'Complete address', value: residingAddress },
          ]} />
        </div>
        {residencePhotos.length ? (
          <div className="mt-4 grid grid-cols-2 gap-4">
            {residencePhotos.map((doc, index) => (
              <ResidencePhoto key={doc.id} doc={doc} index={index} />
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-[3px] border border-dashed border-slate-400 px-2 py-8 text-center text-[10pt] text-slate-500">No photos of the residence are attached to this application.</p>
        )}
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
    // Let the sheet render, then wait (up to a few seconds) for the signed photo
    // URLs to produce their pictures before the dialog opens.
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const loading = document.querySelector('.print-sheet-root [data-loading="true"]');
      if (elapsed < 400 || (loading && elapsed < 8000)) return;
      window.clearInterval(timer);
      window.print();
    }, 150);
    return () => {
      window.clearInterval(timer);
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
